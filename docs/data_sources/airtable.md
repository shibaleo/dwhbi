# Airtable 同期モジュール詳細設計

| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.0.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/airtable.py` |
| ステータス | 実装完了 |

## 1. 概要

### 1.1 目的

Airtable Web API を使用してベース、テーブル（スキーマ情報含む）、レコードのデータを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- アクセス可能なベース一覧の同期
- テーブル定義（フィールド、ビュー）の同期
- レコードの全件同期（ページネーション対応）
- 日次バッチ処理（GitHub Actions から実行）
- raw 層への生データ保存

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| ベース | Airtable のデータベース単位。複数のテーブルを含む |
| テーブル | ベース内のデータ構造。フィールドとビューで定義 |
| レコード | テーブル内の1行のデータ |
| フィールド | テーブルの列定義（型、オプションなど） |
| ビュー | テーブルの表示設定（フィルター、ソートなど） |
| PAT | Personal Access Token（認証トークン） |
| upsert | INSERT or UPDATE（重複時は更新） |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| ネットワーク | Airtable API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| Airtable Web API | データ取得元 | 5リクエスト/秒 |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに Airtable PAT が保存されていること
3. `raw.airtable_*` テーブルが作成済みであること
4. 仮想環境がアクティベートされていること
5. PAT に適切なスコープ（data.records:read, schema.bases:read）が設定されていること

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| レート制限 | 5リクエスト/秒 | 0.2秒間隔で待機 |
| ページサイズ | 最大100件/リクエスト | ページネーション対応 |
| フィールド値 | JSONB として保存 | staging層で型変換 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                    sync_airtable()                          │
│                   メインエントリーポイント                    │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ get_access_     │  │ fetch_*()       │  │   upsert_*()    │
│    token()      │  │ データ取得       │  │  DB書き込み群   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ credentials     │  │ Airtable API    │  │   Supabase      │
│ (PAT管理)        │  │   (外部API)      │  │   raw.*         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── airtable.py       # 本モジュール（Airtable専用ロジック、約350行）
└── lib/
    ├── credentials.py    # 認証情報の取得・復号
    ├── db.py             # Supabaseクライアント
    ├── encryption.py     # AES-GCM暗号化
    └── logger.py         # ロギング設定
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_airtable(base_ids, include_records) 呼び出し
   │
   ├─ 2. 認証
   │   ├─ get_access_token() 呼び出し
   │   ├─ キャッシュ確認 → 有効ならキャッシュから返却
   │   └─ DB から PAT を取得
   │
   ├─ 3. データ取得（HTTPクライアント共有）
   │   ├─ fetch_bases() → GET /meta/bases
   │   │   └─ アクセス可能なベース一覧（ページネーション対応）
   │   │
   │   └─ 各ベースに対して:
   │       ├─ fetch_tables() → GET /meta/bases/{id}/tables
   │       │   └─ テーブル一覧（スキーマ情報含む）
   │       │
   │       └─ include_records=True の場合:
   │           └─ 各テーブルに対して:
   │               └─ fetch_records() → GET /{base_id}/{table_id}
   │                   └─ レコード一覧（ページネーション対応）
   │
   ├─ 4. 型変換（API型 → DB型）
   │   ├─ to_db_base()
   │   ├─ to_db_table()
   │   └─ to_db_record()
   │
   └─ 5. DB保存
       ├─ upsert_bases()   → raw.airtable_bases
       ├─ upsert_tables()  → raw.airtable_tables
       └─ upsert_records() → raw.airtable_records（バッチ処理）
```

### 4.2 ページネーション処理

```python
# ベース一覧・レコード一覧で使用
while True:
    params = {"pageSize": 100}
    if offset:
        params["offset"] = offset

    response = await client.get(url, headers=headers, params=params)
    data = response.json()

    all_items.extend(data.get("records", []))  # または "bases"

    offset = data.get("offset")
    if not offset:
        break

    await asyncio.sleep(0.2)  # レート制限対策
```

### 4.3 レート制限対策

```
┌─────────────────────────────────────────────────────────────┐
│                 レート制限対策                               │
└─────────────────────────────────────────────────────────────┘

Airtable API: 5リクエスト/秒

対策:
1. 各APIリクエスト後に 0.2秒待機
2. バッチ処理でDB書き込みを最適化
3. include_records=False でスキーマのみ取得オプション
```

## 5. 設計判断（ADR）

### ADR-001: Personal Access Token 認証

**決定**: PAT (Personal Access Token) による認証

**理由**:
- Airtable は 2024年2月に API Key を廃止
- PAT は細かいスコープ設定が可能
- OAuth2 より設定が簡単

**トレードオフ**:
- OK: シンプルな認証
- 注意: トークンの有効期限管理が必要

### ADR-002: フィールド値の JSONB 保存

**決定**: レコードのフィールド値は JSONB カラムにそのまま保存

**理由**:
- Airtable のフィールド型は多様（テキスト、数値、日付、リンク、添付ファイルなど）
- テーブルごとにスキーマが異なる
- raw層では加工せず保存

**トレードオフ**:
- OK: 柔軟性が高い
- 注意: 型安全性がない（staging層で対応）

### ADR-003: テーブルスキーマの保存

**決定**: テーブル定義（fields, views）を JSONB として保存

**理由**:
- スキーマ情報を参照して staging 層で型変換可能
- フィールドの追加・削除に柔軟に対応
- ビュー情報も保持

**トレードオフ**:
- OK: 完全なスキーマ情報を保持
- 注意: スキーマ変更時は再同期が必要

### ADR-004: レコードのバッチ保存

**決定**: レコードは 1000件ずつバッチ処理で保存

**理由**:
- 大量レコードの一括保存はメモリ効率が悪い
- Supabase の upsert サイズ制限への対応
- エラー時の影響範囲を限定

**トレードオフ**:
- OK: 安定した保存処理
- 注意: 処理時間は若干増加

### ADR-005: ベースID フィルタリング

**決定**: `base_ids` パラメータで同期対象を絞り込み可能

**理由**:
- 全ベース同期は時間がかかる
- 特定のベースのみ更新したい場合がある
- GitHub Actions から指定可能

**トレードオフ**:
- OK: 柔軟な同期制御
- 注意: フィルタ指定ミスに注意

## 6. データ型定義

### 6.1 API型

```python
class AirtableBase(TypedDict):
    id: str                    # appXXX
    name: str
    permissionLevel: str       # read/comment/edit/create

class AirtableTable(TypedDict):
    id: str                    # tblXXX
    name: str
    primaryFieldId: str
    fields: list[dict[str, Any]]   # フィールド定義
    views: list[dict[str, Any]]    # ビュー定義

class AirtableRecord(TypedDict):
    id: str                    # recXXX
    createdTime: str           # ISO 8601
    fields: dict[str, Any]     # フィールド値
```

### 6.2 DB型

```python
class DbBase(TypedDict):
    id: str
    name: str
    permission_level: str

class DbTable(TypedDict):
    id: str
    base_id: str
    name: str
    primary_field_id: str
    fields: list[dict[str, Any]]
    views: list[dict[str, Any]]

class DbRecord(TypedDict):
    id: str
    base_id: str
    table_id: str
    created_time: str
    fields: dict[str, Any]
```

### 6.3 結果型

```python
class SyncStats(TypedDict):
    bases: int
    tables: int
    records: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | メソッド | 説明 |
|---------|-------------|---------|------|
| Bases | `/v0/meta/bases` | GET | ベース一覧 |
| Tables | `/v0/meta/bases/{baseId}/tables` | GET | テーブル一覧（スキーマ含む） |
| Records | `/v0/{baseId}/{tableIdOrName}` | GET | レコード一覧 |

### 7.2 認証

**Bearer Token Authentication**

```
Authorization: Bearer {personal_access_token}
```

### 7.3 必要なスコープ

| スコープ | 説明 |
|---------|------|
| data.records:read | レコードの読み取り |
| schema.bases:read | ベース・テーブルスキーマの読み取り |

### 7.4 リクエストパラメータ

**レコード取得**:

| パラメータ | 説明 | デフォルト |
|-----------|------|-----------|
| pageSize | 1ページあたりの件数 | 100（最大） |
| offset | ページネーション用オフセット | - |
| view | ビュー名でフィルタ | - |
| filterByFormula | 数式でフィルタ | - |
| sort | ソート設定 | - |

### 7.5 レスポンス例

**ベース一覧**:
```json
{
  "bases": [
    {
      "id": "appXXXXXXXXXXXXXX",
      "name": "My Base",
      "permissionLevel": "create"
    }
  ],
  "offset": "..."
}
```

**テーブル一覧**:
```json
{
  "tables": [
    {
      "id": "tblXXXXXXXXXXXXXX",
      "name": "Tasks",
      "primaryFieldId": "fldXXXXXXXXXXXXXX",
      "fields": [
        {
          "id": "fldXXX",
          "name": "Name",
          "type": "singleLineText"
        }
      ],
      "views": [
        {
          "id": "viwXXX",
          "name": "Grid view",
          "type": "grid"
        }
      ]
    }
  ]
}
```

**レコード一覧**:
```json
{
  "records": [
    {
      "id": "recXXXXXXXXXXXXXX",
      "createdTime": "2025-12-01T00:00:00.000Z",
      "fields": {
        "Name": "Task 1",
        "Status": "Done",
        "Priority": 1
      }
    }
  ],
  "offset": "..."
}
```

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.airtable_bases` | `id` | ベース |
| `raw.airtable_tables` | `id` | テーブル（スキーマ情報含む） |
| `raw.airtable_records` | `id` | レコード |

### 8.2 テーブル定義

**raw.airtable_bases**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (appXXX) |
| name | TEXT | NO | - | ベース名 |
| permission_level | TEXT | YES | 'read' | 権限レベル |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.airtable_tables**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (tblXXX) |
| base_id | TEXT | NO | - | FK → airtable_bases.id |
| name | TEXT | NO | - | テーブル名 |
| primary_field_id | TEXT | YES | - | プライマリフィールドID |
| fields | JSONB | YES | - | フィールド定義 |
| views | JSONB | YES | - | ビュー定義 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.airtable_records**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (recXXX) |
| base_id | TEXT | NO | - | ベースID |
| table_id | TEXT | NO | - | テーブルID |
| created_time | TIMESTAMPTZ | NO | - | レコード作成日時 |
| fields | JSONB | YES | - | フィールド値 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.3 インデックス

```sql
CREATE INDEX idx_airtable_tables_base_id ON raw.airtable_tables(base_id);
CREATE INDEX idx_airtable_records_base_id ON raw.airtable_records(base_id);
CREATE INDEX idx_airtable_records_table_id ON raw.airtable_records(table_id);
CREATE INDEX idx_airtable_records_created_time ON raw.airtable_records(created_time);
CREATE INDEX idx_airtable_records_fields ON raw.airtable_records USING GIN(fields);
```

### 8.4 外部キー制約

```sql
ALTER TABLE raw.airtable_tables
  ADD CONSTRAINT airtable_tables_base_id_fkey
  FOREIGN KEY (base_id) REFERENCES raw.airtable_bases(id);
```

## 9. エラーハンドリング

### 9.1 エラー分類

| エラータイプ | 検出方法 | 対処 |
|------------|---------|------|
| 認証エラー | 401 | PAT を確認・再生成 |
| 権限エラー | 403 | PAT のスコープを確認 |
| Not Found | 404 | ベースID/テーブルID を確認 |
| レート制限 | 429 | 待機して再試行 |
| サーバーエラー | 500系 | リトライ可能 |
| タイムアウト | httpx.TimeoutException | 60秒、ログ記録 |

### 9.2 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | personal_access_token 未設定 | credentials.services を確認 |
| `httpx.HTTPStatusError` | APIエラー | ステータスコードを確認 |
| `httpx.TimeoutException` | タイムアウト（60秒） | ネットワーク確認 |

## 10. パフォーマンス

### 10.1 ベンチマーク（2ベース、5テーブル、500レコードの場合）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| 認証情報取得 | <1秒 | 0 |
| ベース一覧取得 | ~1秒 | 1 |
| テーブル一覧取得 | ~2秒 | 2 |
| レコード取得 | ~6秒 | 5×2ページ=10 |
| DB保存 | ~2秒 | 3 |
| **合計** | **~12秒** | **~15** |

### 10.2 計測指標

| 指標 | 説明 | 目標値 |
|------|------|--------|
| HTTP リクエスト数 | Airtable API への呼び出し回数 | 1 + ベース数 + テーブル数×ページ数 |
| fetch 時間 | API 取得の合計時間 | < 30秒 |
| db 時間 | DB 保存の合計時間 | < 10秒 |
| 合計時間 | 同期全体の時間 | < 60秒 |

### 10.3 最適化手法

1. **トークンのキャッシュ**: DB アクセス削減
2. **HTTPクライアント共有**: コネクション再利用
3. **0.2秒間隔待機**: レート制限回避
4. **バッチ保存**: 1000件ずつ DB 書き込み
5. **include_records=False**: スキーマのみ取得オプション

## 11. 運用

### 11.1 実行方法

**Personal Access Token の作成**:
1. https://airtable.com/create/tokens にアクセス
2. 「Create new token」をクリック
3. 名前を入力（例: "Sync Bot"）
4. スコープを追加:
   - `data.records:read`
   - `schema.bases:read`
5. アクセス対象のベースを選択
6. トークンを生成・コピー

**認証情報の保存**:
```sql
-- credentials.services に PAT を保存（暗号化）
-- init スクリプトまたは手動で設定
```

**手動同期**:
```bash
# 全ベース同期
python -m pipelines.services.airtable

# 特定ベースのみ
python -c "
import asyncio
from pipelines.services.airtable import sync_airtable
asyncio.run(sync_airtable(base_ids=['appXXXXXXXX']))
"

# スキーマのみ（レコードなし）
python -c "
import asyncio
from pipelines.services.airtable import sync_airtable
asyncio.run(sync_airtable(include_records=False))
"
```

**GitHub Actions**:
```yaml
# .github/workflows/sync-airtable.yml
- name: Sync Airtable
  env:
    AIRTABLE_BASE_IDS: ${{ inputs.base_ids || '' }}
    AIRTABLE_INCLUDE_RECORDS: ${{ inputs.include_records || 'true' }}
  run: |
    python -c "
    import asyncio
    import os
    from pipelines.services.airtable import sync_airtable
    base_ids_str = os.environ.get('AIRTABLE_BASE_IDS', '')
    base_ids = [b.strip() for b in base_ids_str.split(',') if b.strip()] or None
    include_records = os.environ.get('AIRTABLE_INCLUDE_RECORDS', 'true').lower() == 'true'
    asyncio.run(sync_airtable(base_ids=base_ids, include_records=include_records))
    "
```

### 11.2 必要な環境変数

`.env` ファイルに設定：

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=...
```

### 11.3 認証情報の設定

`credentials.services` テーブルに保存（暗号化済み）：

```json
{
  "personal_access_token": "patXXX.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

### 11.4 ログ出力

```
[2025-12-01 12:00:00] INFO [airtable] Starting Airtable sync (include_records=True)
[2025-12-01 12:00:01] INFO [airtable] Fetching bases...
[2025-12-01 12:00:02] INFO [airtable] Fetched 2 bases
[2025-12-01 12:00:02] INFO [airtable] Processing base 'Project Tracker'...
[2025-12-01 12:00:03] INFO [airtable]   Table 'Tasks': 150 records
[2025-12-01 12:00:04] INFO [airtable]   Table 'Projects': 25 records
[2025-12-01 12:00:05] INFO [airtable] Base 'Project Tracker': 2 tables, 175 records
[2025-12-01 12:00:06] INFO [airtable] Processing base 'CRM'...
[2025-12-01 12:00:07] INFO [airtable]   Table 'Contacts': 200 records
[2025-12-01 12:00:08] INFO [airtable]   Table 'Companies': 50 records
[2025-12-01 12:00:09] INFO [airtable]   Table 'Deals': 75 records
[2025-12-01 12:00:10] INFO [airtable] Base 'CRM': 3 tables, 325 records
[2025-12-01 12:00:10] INFO [airtable] Fetched 2 bases, 5 tables, 500 records
[2025-12-01 12:00:10] INFO [airtable] Saving to database...
[2025-12-01 12:00:12] INFO [airtable] Saved 2 bases to raw.airtable_bases
[2025-12-01 12:00:12] INFO [airtable] Saved 5 tables to raw.airtable_tables
[2025-12-01 12:00:14] INFO [airtable] Saved 500 records to raw.airtable_records
[2025-12-01 12:00:14] INFO [airtable] Airtable sync completed in 14.23s (db: 4.15s)
```

## 12. セキュリティ

### 12.1 認証情報の保護

- PAT は AES-GCM で暗号化して保存
- `TOKEN_ENCRYPTION_KEY` は環境変数から取得
- GitHub Actions では Secrets として管理
- PAT は必要最小限のスコープで発行

### 12.2 推奨スコープ

| スコープ | 必要性 | 説明 |
|---------|--------|------|
| data.records:read | 必須 | レコード読み取り |
| schema.bases:read | 必須 | スキーマ読み取り |
| data.records:write | オプション | 将来の双方向同期用 |

## 13. 将来対応

### 13.1 短期（1-2ヶ月）

- [x] PAT 認証
- [x] GitHub Actions 統合
- [ ] 差分同期（更新日時ベース）

### 13.2 中期（3-6ヶ月）

- [ ] フィールド型の自動マッピング
- [ ] 添付ファイルの取得

### 13.3 長期（6ヶ月以降）

- [ ] Webhook によるリアルタイム同期
- [ ] 双方向同期（Supabase → Airtable）

## 14. 参考資料

### 14.1 外部ドキュメント

- [Airtable Web API](https://airtable.com/developers/web/api)
- [Personal Access Tokens](https://airtable.com/developers/web/guides/personal-access-tokens)
- [Authentication](https://airtable.com/developers/web/api/authentication)
- [API Key Deprecation](https://support.airtable.com/docs/airtable-api-key-deprecation-notice)

### 14.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/20251201030000_create_airtable_tables.sql` - DBスキーマ

## 15. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成 |

---

**ドキュメント終了**
