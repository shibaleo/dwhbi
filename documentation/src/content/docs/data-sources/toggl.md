---
title: Toggl Track 同期モジュール詳細設計
---


| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.1.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/toggl.py` |
| ステータス | 実装完了・運用中 |

## 1. 概要

### 1.1 目的

Toggl Track API v9 からデータを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- クライアント、プロジェクト、タグ、時間エントリーの同期
- 日次バッチ処理（GitHub Actions から実行予定）
- raw 層への生データ保存（staging 以降の変換は別モジュール）

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| エントリー | Toggl の時間記録1件 |
| メタデータ | clients, projects, tags の総称 |
| 実行中エントリー | 現在計測中のエントリー（duration < 0） |
| upsert | INSERT or UPDATE（重複時は更新） |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| ネットワーク | Toggl API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| Toggl Track API v9 | データ取得元 | 1リクエスト/秒（公式非公開） |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに Toggl 認証情報が保存されていること
3. `raw.toggl_*` テーブルが作成済みであること
4. 仮想環境がアクティベートされていること

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| Reports API 未対応 | billable_amount, currency は取得不可 | 将来対応予定 |
| 差分同期未実装 | 毎回全件取得（指定日数分） | since パラメータ対応予定 |
| 単一ワークスペース | 複数ワークスペース非対応 | 現状は1ワークスペースのみ運用 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                     sync_toggl()                            │
│                    メインエントリーポイント                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│ fetch_all_metadata_     │     │     upsert_*()          │
│ and_entries()           │     │   DB書き込み関数群       │
│ 並列API取得              │     │                         │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   Toggl API v9          │     │   Supabase raw.*        │
│   (外部API)              │     │   (PostgreSQL)          │
└─────────────────────────┘     └─────────────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── toggl.py          # 本モジュール（Toggl専用ロジック、約600行）
└── lib/
    ├── credentials.py    # 認証情報の取得・復号
    ├── db.py             # Supabaseクライアント
    ├── encryption.py     # AES-GCM暗号化
    └── logger.py         # ロギング設定
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_toggl(days=3) 呼び出し
   │
   ├─ 2. 日付範囲計算（today - days + 1 〜 today）
   │
   ├─ 3. 認証情報取得（キャッシュ優先）
   │   ├─ get_auth_headers() → Basic認証ヘッダー
   │   └─ get_workspace_id() → ワークスペースID
   │
   ├─ 4. fetch_all_metadata_and_entries() で並列取得
   │   ├─ GET /workspaces/{id}/clients
   │   ├─ GET /workspaces/{id}/projects
   │   ├─ GET /workspaces/{id}/tags
   │   └─ GET /me/time_entries?start_date=...&end_date=...
   │
   ├─ 5. 型変換（API型 → DB型）
   │   ├─ to_db_client()
   │   ├─ to_db_project()
   │   ├─ to_db_tag()
   │   └─ to_db_entry()
   │
   └─ 6. DB保存（メタデータ → エントリーの順序）
       ├─ upsert_clients()   → raw.toggl_clients
       ├─ upsert_projects()  → raw.toggl_projects
       ├─ upsert_tags()      → raw.toggl_tags
       └─ upsert_entries()   → raw.toggl_entries
```

### 4.2 保存順序の理由

メタデータを先に保存する理由：

1. `toggl_entries.project_id` は `toggl_projects.id` への外部キー
2. 参照整合性を保つため、参照先を先に保存する必要がある

## 5. 設計判断（ADR）

### ADR-001: 並列取得の採用

**決定**: 4つのAPIを `asyncio.gather()` で並列実行

**理由**:
- 順次実行では約5秒 → 並列実行で約1.5秒に短縮
- Toggl API のレート制限は緩い（1リクエスト/秒程度）
- 4リクエスト程度なら問題なし

**代替案**:
- 逐次取得 → 処理時間増

**トレードオフ**:
- OK: 処理時間の大幅短縮
- 注意: エラー時の原因特定が若干困難になる
- 注意: 将来レート制限が厳しくなった場合は要見直し

### ADR-002: 認証情報のキャッシュ

**決定**: モジュールレベル変数でキャッシュ

**理由**:
- `get_credentials()` は毎回 DB アクセスを伴う
- 1回の同期中に認証情報は変わらない
- 4回の DB アクセスを1回に削減

**代替案**:
- 毎回DBアクセス → パフォーマンス低下

**トレードオフ**:
- OK: DBアクセス削減
- 注意: 長時間実行時にトークン更新が反映されない（現状問題なし）
- 注意: テスト時は `reset_cache()` で明示的にリセットが必要

### ADR-003: 実行中エントリーの保存

**決定**: 実行中エントリー（duration < 0）も保存する

**理由**:
- Deno版との互換性維持
- 次回同期時に完了状態で上書きされる
- staging ビューで動的に `CURRENT_TIMESTAMP` を補完可能

**代替案**:
- 実行中エントリーを除外 → データ欠損リスク

**トレードオフ**:
- OK: データ完全性
- 注意: `end` と `duration_ms` が NULL のレコードが存在する
- 注意: 集計時に NULL ハンドリングが必要

### ADR-004: HTTPクライアントの共有

**決定**: 1つの `httpx.AsyncClient` で全リクエストを処理

**理由**:
- コネクションプーリングによる効率化
- TLS ハンドシェイクのオーバーヘッド削減

**代替案**:
- リクエストごとにクライアント作成 → オーバーヘッド増

**トレードオフ**:
- OK: パフォーマンス向上
- 注意: なし

## 6. データ型定義

### 6.1 API型

```python
class TogglClient(TypedDict):
    id: int
    wid: int  # workspace_id
    name: str
    archived: bool
    at: str  # ISO8601

class TogglProject(TypedDict):
    id: int
    workspace_id: int
    client_id: int | None
    name: str
    color: str | None
    is_private: bool
    active: bool
    billable: bool | None
    created_at: str
    at: str  # ISO8601
    server_deleted_at: str | None

class TogglTag(TypedDict):
    id: int
    workspace_id: int
    name: str
    at: str  # ISO8601

class TogglTimeEntry(TypedDict):
    id: int
    workspace_id: int
    project_id: int | None
    task_id: int | None
    user_id: int
    description: str | None
    start: str  # ISO8601
    stop: str | None  # ISO8601
    duration: int  # 秒（負の値は実行中）
    billable: bool
    tags: list[str]
    at: str  # ISO8601
```

### 6.2 DB型

```python
class DbClient(TypedDict):
    id: int
    workspace_id: int
    name: str
    is_archived: bool
    created_at: str

class DbProject(TypedDict):
    id: int
    workspace_id: int
    client_id: int | None
    name: str
    color: str | None
    is_private: bool
    is_active: bool
    is_billable: bool
    created_at: str
    archived_at: str | None

class DbTag(TypedDict):
    id: int
    workspace_id: int
    name: str
    created_at: str

class DbEntry(TypedDict):
    id: int
    workspace_id: int
    project_id: int | None
    task_id: int | None
    user_id: int
    description: str | None
    start: str
    end: str | None  # 実行中はNone
    duration_ms: int | None  # 実行中はNone
    is_billable: bool
    billable_amount: float | None
    currency: str | None
    tags: list[str]
    updated_at: str
```

### 6.3 結果型

```python
class SyncStats(TypedDict):
    clients: int
    projects: int
    tags: int
    entries: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats

class FetchResult(TypedDict):
    clients: list[TogglClient]
    projects: list[TogglProject]
    tags: list[TogglTag]
    entries: list[TogglTimeEntry]
    http_requests: int
    elapsed_seconds: float
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | メソッド | レスポンス |
|---------|-------------|---------|-----------|
| Clients | `/api/v9/workspaces/{wid}/clients` | GET | `[{client}, ...]` |
| Projects | `/api/v9/workspaces/{wid}/projects` | GET | `[{project}, ...]` |
| Tags | `/api/v9/workspaces/{wid}/tags` | GET | `[{tag}, ...]` |
| Entries | `/api/v9/me/time_entries` | GET | `[{entry}, ...]` |

### 7.2 認証

**Basic Authentication**

```
Authorization: Basic {base64(api_token:api_token)}
```

### 7.3 リクエストパラメータ

**Time Entries**:

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| start_date | 開始日（ISO8601） | "2025-11-28T00:00:00Z" |
| end_date | 終了日（ISO8601） | "2025-12-01T23:59:59Z" |

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.toggl_clients` | `id` | クライアント |
| `raw.toggl_projects` | `id` | プロジェクト |
| `raw.toggl_tags` | `id` | タグ |
| `raw.toggl_entries` | `id` | 時間エントリー |

### 8.2 テーブル定義

**raw.toggl_clients**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | PK |
| workspace_id | BIGINT | NO | - | ワークスペースID |
| name | TEXT | NO | - | クライアント名 |
| is_archived | BOOLEAN | YES | false | アーカイブ済みか |
| created_at | TIMESTAMPTZ | NO | - | 作成日時 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.toggl_projects**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | PK |
| workspace_id | BIGINT | NO | - | ワークスペースID |
| client_id | BIGINT | YES | - | FK → toggl_clients.id |
| name | TEXT | NO | - | プロジェクト名 |
| color | TEXT | YES | - | カラーコード |
| is_private | BOOLEAN | YES | false | プライベートか |
| is_active | BOOLEAN | YES | true | アクティブか |
| is_billable | BOOLEAN | YES | false | 課金対象か |
| created_at | TIMESTAMPTZ | NO | - | 作成日時 |
| archived_at | TIMESTAMPTZ | YES | - | アーカイブ日時 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.toggl_tags**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | PK |
| workspace_id | BIGINT | NO | - | ワークスペースID |
| name | TEXT | NO | - | タグ名 |
| created_at | TIMESTAMPTZ | NO | - | 作成日時 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.toggl_entries**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | BIGINT | NO | - | PK |
| workspace_id | BIGINT | NO | - | ワークスペースID |
| project_id | BIGINT | YES | - | FK → toggl_projects.id |
| task_id | BIGINT | YES | - | タスクID |
| user_id | BIGINT | YES | - | ユーザーID |
| description | TEXT | YES | - | 説明 |
| start | TIMESTAMPTZ | NO | - | 開始時刻 |
| end | TIMESTAMPTZ | YES | - | 終了時刻（実行中はNULL） |
| duration_ms | BIGINT | YES | - | 期間ミリ秒（実行中はNULL） |
| is_billable | BOOLEAN | YES | false | 課金対象か |
| billable_amount | NUMERIC | YES | - | 課金額（Reports APIのみ） |
| currency | TEXT | YES | - | 通貨（Reports APIのみ） |
| tags | TEXT[] | YES | - | タグ配列 |
| updated_at | TIMESTAMPTZ | YES | - | 更新日時 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.3 外部キー制約

```sql
ALTER TABLE raw.toggl_projects
  ADD CONSTRAINT toggl_projects_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES raw.toggl_clients(id);

ALTER TABLE raw.toggl_entries
  ADD CONSTRAINT toggl_entries_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES raw.toggl_projects(id);
```

## 9. エラーハンドリング

### 9.1 エラー分類

| エラータイプ | 検出方法 | 対処 |
|------------|---------|------|
| 認証エラー | 401/403 | 即座に終了 |
| レート制限 | 429 | 即座に終了 |
| サーバーエラー | 500系 | リトライ（最大3回） |
| クライアントエラー | 400系 | 即座に終了 |
| タイムアウト | httpx.TimeoutException | 30秒、ログ記録 |

### 9.2 リトライ戦略

| エラー種別 | 対応 | リトライ回数 |
|-----------|------|-------------|
| 500系（サーバーエラー） | リトライ | 最大3回 |
| 429（レート制限） | 即座に終了 | なし |
| 401/403（認証エラー） | 即座に終了 | なし |
| 400系（クライアントエラー） | 即座に終了 | なし |

### 9.3 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | api_token/workspace_id 未設定 | credentials.services を確認 |
| `httpx.HTTPStatusError` | APIエラー | ログを確認し原因を特定 |
| `httpx.TimeoutException` | タイムアウト（30秒） | ネットワーク状況を確認 |

## 10. パフォーマンス

### 10.1 ベンチマーク（3日分同期）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| 認証情報取得 | <1秒 | 0 |
| データ取得（並列） | ~1.5秒 | 4 |
| データ変換 | <1秒 | 0 |
| DB保存 | ~1秒 | 4 |
| **合計** | **~3秒** | **4** |

### 10.2 計測指標

| 指標 | 説明 | 目標値 |
|------|------|--------|
| HTTP リクエスト数 | Toggl API への呼び出し回数 | 4回/同期 |
| fetch 時間 | API 取得の合計時間 | < 3秒 |
| db 時間 | DB 保存の合計時間 | < 3秒 |
| 合計時間 | 同期全体の時間 | < 6秒 |

### 10.3 最適化手法

1. **認証情報のキャッシュ**: DB アクセス削減
2. **HTTP クライアント共有**: コネクション再利用
3. **並列 API 取得**: 待ち時間の最小化
4. **upsert**: 存在チェック不要

## 11. テスト戦略

### 11.1 テスト構成

| テストタイプ | ファイル | 件数 | カバレッジ |
|------------|---------|------|-----------|
| Unit Tests | `tests/pipelines/test_toggl.py` | 8 | Helper, Transform, DB |
| Integration Tests | 同上 | 4 | API Fetch, Full Sync |
| **合計** | - | **12** | **~90%** |

### 11.2 主要テストケース

**Authentication (2件)**:
- `test_get_auth_headers_success`: 正常系
- `test_get_auth_headers_missing_token`: api_token欠損

**API Fetch (3件)**:
- `test_fetch_entries_by_range_success`: 正常系
- `test_fetch_entries_by_range_500_retry`: 500エラーリトライ
- `test_fetch_entries_by_range_400_no_retry`: 400エラー即終了

**Data Transformation (2件)**:
- `test_to_db_entry`: 全フィールド変換
- `test_to_db_entry_minimal`: 最小フィールド変換

**DB Operations (3件)**:
- `test_upsert_entries_success`: 正常系
- `test_upsert_entries_filters_running`: 実行中エントリー
- `test_upsert_entries_empty`: 空リスト

**Full Sync (2件)**:
- `test_sync_toggl_success`: エンドツーエンド
- `test_sync_toggl_date_range`: 日付範囲計算

### 11.3 テスト実行

```bash
# 全テスト実行
pytest tests/pipelines/test_toggl.py -v

# 特定カテゴリのテスト
pytest tests/pipelines/test_toggl.py -k "upsert" -v  # DB書き込み
pytest tests/pipelines/test_toggl.py -k "auth" -v    # 認証
pytest tests/pipelines/test_toggl.py -k "fetch" -v   # API取得
pytest tests/pipelines/test_toggl.py -k "sync" -v    # 統合

# カバレッジ測定
pytest tests/pipelines/test_toggl.py --cov=pipelines.services.toggl
```

### 11.4 テストカバレッジ対応表

| 関数/クラス | テスト | カバレッジ |
|------------|--------|-----------|
| `get_auth_headers` | `test_get_auth_headers_*` (2件) | 100% |
| `get_workspace_id` | 間接テスト（sync経由） | 100% |
| `fetch_entries_by_range` | `test_fetch_entries_by_range_*` (3件) | 100% |
| `to_db_entry` | `test_to_db_entry_*` (2件) | 100% |
| `upsert_entries` | `test_upsert_entries_*` (3件) | 100% |
| `sync_toggl` | `test_sync_toggl_*` (2件) | 100% |

## 12. 運用

### 12.1 実行方法

**手動実行**:
```bash
# 仮想環境アクティベート
source .venv/Scripts/activate

# 3日分同期（デフォルト）
python -c "import asyncio; from pipelines.services.toggl import sync_toggl; asyncio.run(sync_toggl(days=3))"

# 7日分同期
python -c "import asyncio; from pipelines.services.toggl import sync_toggl; asyncio.run(sync_toggl(days=7))"
```

**GitHub Actions（予定）**:
```yaml
# .github/workflows/sync-daily.yml
- name: Sync Toggl
  run: python -m pipelines.services.toggl
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    ENCRYPTION_KEY: ${{ secrets.ENCRYPTION_KEY }}
```

### 12.2 必要な環境変数

`.env` ファイルに設定：

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=...
```

### 12.3 認証情報の設定

`credentials.services` テーブルに保存（暗号化済み）：

```json
{
  "api_token": "your_toggl_api_token",
  "workspace_id": "123456"
}
```

### 12.4 ログ出力

```
[2025-12-01 11:14:47] INFO [toggl] Starting Toggl sync (3 days)
[2025-12-01 11:14:48] INFO [toggl] Fetched 5 clients, 24 projects, 5 tags, 79 entries (4 HTTP requests in 1.23s)
[2025-12-01 11:14:48] INFO [toggl] Saving to database...
[2025-12-01 11:14:49] INFO [toggl] Saved 5 clients to raw.toggl_clients
[2025-12-01 11:14:49] INFO [toggl] Saved 24 projects to raw.toggl_projects
[2025-12-01 11:14:49] INFO [toggl] Saved 5 tags to raw.toggl_tags
[2025-12-01 11:14:50] INFO [toggl] Saved 79 entries to raw.toggl_entries
[2025-12-01 11:14:50] INFO [toggl] Toggl sync completed in 2.45s: 5 clients, 24 projects, 5 tags, 79 entries
```

### 12.5 モニタリング

**監視項目**:
- 同期成功/失敗回数
- データ件数（clients, projects, tags, entries）
- 処理時間
- レート制限到達回数

**アラート条件**:
- 3日連続同期失敗
- 処理時間が10秒超

## 13. 将来対応

### 13.1 短期（1-2ヶ月）

- [ ] GitHub Actions 統合
- [ ] Deno版との並行運用・データ整合性検証

### 13.2 中期（3-6ヶ月）

- [ ] Reports API v3 対応（billable_amount, currency の取得）
- [ ] 差分同期（`since` パラメータによる増分同期）

### 13.3 長期（6ヶ月以降）

- [ ] 複数ワークスペース対応

## 14. 参考資料

### 14.1 外部ドキュメント

- [Toggl Track API v9](https://developers.track.toggl.com/docs/)
- [Toggl Reports API v3](https://developers.track.toggl.com/docs/reports_api/)

### 14.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/` - DBスキーマ
- `tests/pipelines/test_toggl.py` - テストコード

## 15. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成。Deno版からPython版への移行完了 |
| 1.1.0 | 2025-12-01 | フォーマット統一（ADR形式、セクション構成） |

---

**ドキュメント終了**
