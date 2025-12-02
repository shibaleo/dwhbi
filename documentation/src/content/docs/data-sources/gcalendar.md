---
title: Google Calendar 同期モジュール詳細設計
---


| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.1.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/gcalendar.py` |
| ステータス | 実装完了・運用中 |

## 1. 概要

### 1.1 目的

Google Calendar API v3 からイベントデータを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- カレンダーイベントの同期（通常イベント・終日イベント・繰り返しイベント）
- 日次バッチ処理（GitHub Actions から実行予定）
- raw 層への生データ保存（staging 以降の変換は別モジュール）

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| イベント | Google Calendar の予定1件 |
| 終日イベント | 時刻指定なしの予定（`start.date` を使用） |
| 通常イベント | 時刻指定ありの予定（`start.dateTime` を使用） |
| 繰り返しイベント | 定期的に発生するイベント（`singleEvents=true` で展開） |
| Service Account | Google Cloud のサービスアカウント認証 |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| ネットワーク | Google API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| Google Calendar API v3 | データ取得元 | 100万リクエスト/日（プロジェクト単位） |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに GCalendar 認証情報が保存されていること
3. `raw.gcalendar_events` テーブルが作成済みであること
4. Google Cloud でサービスアカウントが作成済みであること
5. カレンダーにサービスアカウントのメールアドレスが共有されていること

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| 読み取り専用 | イベントの作成・更新・削除は不可 | 現状は取得のみの運用 |
| 単一カレンダー | 複数カレンダー非対応 | 現状は1カレンダーのみ運用 |
| キャンセルイベント | 削除検出は未実装 | 将来対応予定 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                   sync_gcalendar()                          │
│                  メインエントリーポイント                     │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   fetch_all_events()    │     │    upsert_events()      │
│   API取得+変換           │     │    DB書き込み           │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  Google Calendar API    │     │   Supabase raw.*        │
│       (外部API)          │     │    (PostgreSQL)         │
└─────────────────────────┘     └─────────────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── gcalendar.py      # 本モジュール（GCalendar専用ロジック、約480行）
└── lib/
    ├── credentials.py    # 認証情報の取得・復号
    ├── db.py             # Supabaseクライアント
    ├── encryption.py     # AES-GCM暗号化
    └── logger.py         # ロギング設定
```

### 3.3 認証フロー

```
1. load_service_account()
   │  └─ credentials.services から service_account_json を取得
   │
2. create_jwt_sync()
   │  └─ RS256署名でJWTを生成
   │
3. get_access_token_with_client()
   │  └─ JWT → アクセストークン交換（OAuth 2.0）
   │
4. fetch_all_events()
      └─ Bearer トークンでAPI呼び出し
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_gcalendar(days=7) 呼び出し
   │
   ├─ 2. 日付範囲計算（today - days - 1 〜 today + 1）
   │
   ├─ 3. fetch_all_events() 実行
   │   ├─ load_service_account() → 認証情報取得
   │   ├─ create_jwt_sync() → JWT生成
   │   ├─ POST /oauth2/token → アクセストークン取得
   │   └─ GET /calendars/{id}/events → イベント取得（ページネーション）
   │
   ├─ 4. 型変換（API型 → DB型）
   │   └─ to_db_event() × N件
   │
   └─ 5. DB保存
       └─ upsert_events() → raw.gcalendar_events
```

### 4.2 終日イベントの変換

```python
# API レスポンス（終日イベント）
{
  "start": { "date": "2025-12-25" },
  "end": { "date": "2025-12-26" }
}

# DB 保存形式
{
  "start_time": "2025-12-25T00:00:00+09:00",
  "end_time": "2025-12-26T00:00:00+09:00",
  "is_all_day": true
}
```

## 5. 設計判断（ADR）

### ADR-001: Service Account JWT 認証の採用

**決定**: OAuth 2.0 ではなく Service Account JWT 認証を使用

**理由**:
- ユーザー介入なしで自動実行可能
- トークンリフレッシュ不要（毎回 JWT 生成）
- サーバー間通信に最適

**代替案**:
- OAuth 2.0 Authorization Code Flow → ユーザー介入必要

**トレードオフ**:
- OK: 自動化に最適
- 注意: カレンダーへの共有設定が必要
- 注意: ユーザー個人のカレンダーには直接アクセス不可

### ADR-002: 繰り返しイベントの展開

**決定**: `singleEvents=true` で繰り返しイベントを個別イベントとして取得

**理由**:
- 日時ベースの分析が容易
- Toggl との予実比較が簡単
- 個別イベントとして保存することで時間集計が可能

**代替案**:
- 繰り返しルールのまま保存 → 分析が複雑化

**トレードオフ**:
- OK: 分析・集計が容易
- 注意: データ量が増加する（繰り返し回数分）
- 注意: 繰り返しルール自体は保存されない

### ADR-003: duration_ms の自動計算

**決定**: DB の GENERATED ALWAYS カラムで自動計算

**理由**:
- アプリケーションでの計算が不要
- 常に正確な値が保証される
- Toggl との duration 比較が容易

**代替案**:
- アプリケーションで計算 → 計算ロジックの分散

**トレードオフ**:
- OK: PostgreSQL の機能を活用
- 注意: なし

### ADR-004: HTTPクライアントの共有

**決定**: トークン取得とイベント取得で同一クライアントを使用

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
class GCalDateTime(TypedDict, total=False):
    date: str        # YYYY-MM-DD（終日イベント）
    dateTime: str    # ISO 8601（通常イベント）
    timeZone: str

class GCalEvent(TypedDict, total=False):
    id: str
    etag: str
    status: str      # confirmed / tentative / cancelled
    htmlLink: str
    created: str
    updated: str
    summary: str
    description: str
    colorId: str
    recurringEventId: str
    start: GCalDateTime
    end: GCalDateTime

class GCalEventsListResponse(TypedDict):
    kind: str
    etag: str
    summary: str
    updated: str
    timeZone: str
    accessRole: str
    nextPageToken: str | None
    nextSyncToken: str | None
    items: list[GCalEvent]
```

### 6.2 認証情報型

```python
class ServiceAccountCredentials(TypedDict):
    type: str
    project_id: str
    private_key_id: str
    private_key: str
    client_email: str
    client_id: str
    auth_uri: str
    token_uri: str
    auth_provider_x509_cert_url: str
    client_x509_cert_url: str
```

### 6.3 DB型

```python
class DbEvent(TypedDict):
    id: str
    calendar_id: str
    summary: str | None
    description: str | None
    start_time: str       # TIMESTAMPTZ
    end_time: str         # TIMESTAMPTZ
    is_all_day: bool
    color_id: str | None
    status: str | None
    recurring_event_id: str | None
    etag: str | None
    updated: str | None
```

### 6.4 結果型

```python
class SyncStats(TypedDict):
    fetched: int
    upserted: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats

class FetchResult(TypedDict):
    events: list[DbEvent]
    http_requests: int
    elapsed_seconds: float
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | メソッド | レスポンス |
|---------|-------------|---------|-----------|
| Events | `/calendar/v3/calendars/{calendarId}/events` | GET | `{items: [...]}` |

### 7.2 認証

**Service Account JWT → Bearer Token**

1. JWT生成（RS256署名）
2. POST `https://oauth2.googleapis.com/token` でアクセストークン取得
3. `Authorization: Bearer {token}` でAPI呼び出し

### 7.3 リクエストパラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| timeMin | 開始日時（RFC3339） | "2025-11-28T00:00:00Z" |
| timeMax | 終了日時（RFC3339） | "2025-12-02T00:00:00Z" |
| singleEvents | 繰り返しイベントを展開 | true |
| orderBy | ソート順 | "startTime" |
| maxResults | 1ページの最大件数 | 2500 |
| pageToken | ページネーショントークン | - |

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.gcalendar_events` | `id` | カレンダーイベント |

### 8.2 テーブル定義

**raw.gcalendar_events**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK（Google Calendar イベントID） |
| calendar_id | TEXT | NO | - | カレンダーID |
| summary | TEXT | YES | - | イベント名（Toggl description に相当） |
| description | TEXT | YES | - | イベント詳細（Toggl client に相当） |
| start_time | TIMESTAMPTZ | NO | - | 開始日時 |
| end_time | TIMESTAMPTZ | NO | - | 終了日時 |
| duration_ms | BIGINT | - | GENERATED | 期間ミリ秒（自動計算） |
| is_all_day | BOOLEAN | YES | false | 終日イベントフラグ |
| color_id | TEXT | YES | - | カラーID |
| status | TEXT | YES | - | ステータス（confirmed/tentative/cancelled） |
| recurring_event_id | TEXT | YES | - | 繰り返しイベントの親ID |
| etag | TEXT | YES | - | 変更検出用ETag |
| updated | TIMESTAMPTZ | YES | - | イベント更新日時（API） |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.3 duration_ms の計算式

```sql
duration_ms BIGINT GENERATED ALWAYS AS (
    EXTRACT(epoch FROM (end_time - start_time)) * 1000
) STORED
```

### 8.4 インデックス

```sql
CREATE INDEX idx_gcalendar_events_start_time ON raw.gcalendar_events(start_time);
CREATE INDEX idx_gcalendar_events_calendar_id ON raw.gcalendar_events(calendar_id);
```

## 9. エラーハンドリング

### 9.1 エラー分類

| エラータイプ | 検出方法 | 対処 |
|------------|---------|------|
| 認証エラー | 401/403 | 即座に終了 |
| レート制限 | 429 | Retry-After秒数を取得して例外 |
| サーバーエラー | 500系 | 例外発生（将来リトライ対応） |
| タイムアウト | httpx.TimeoutException | 30秒、ログ記録 |

### 9.2 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | service_account_json/calendar_id 未設定 | credentials.services を確認 |
| `ValueError` | private_key/client_email 欠損 | サービスアカウントJSONを確認 |
| `httpx.HTTPStatusError` | APIエラー | ログを確認し原因を特定 |
| `httpx.TimeoutException` | タイムアウト（30秒） | ネットワーク状況を確認 |

### 9.3 認証情報の検証

```python
# 必須フィールドの検証
if not credentials.get("client_email") or not credentials.get("private_key"):
    raise ValueError("Invalid credentials: missing client_email or private_key")
```

## 10. パフォーマンス

### 10.1 ベンチマーク（3日分同期）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| DB認証情報取得 | ~1.4秒 | 0 |
| JWT→トークン交換 | ~0.2秒 | 1 |
| events.list API | ~3.4秒 | 1 |
| データ変換 | <1秒 | 0 |
| DB保存 | ~0.5秒 | 1 |
| **合計** | **~6秒** | **2** |

### 10.2 計測指標

| 指標 | 説明 | 実測値（3日間） |
|------|------|----------------|
| HTTP リクエスト数 | API への呼び出し回数 | 2回 |
| fetch 時間 | 認証 + API 取得の合計時間 | 約5秒 |
| db 時間 | DB 保存の時間 | 約0.5秒 |
| 合計時間 | 同期全体の時間 | 約6秒 |

### 10.3 最適化の限界

- DB認証情報取得とGoogle API呼び出しがボトルネック
- ネットワークレイテンシが主因のため、アプリケーション側での最適化は困難
- GitHub Actions での毎回新規プロセス実行のため、インメモリキャッシュは無効

## 11. テスト戦略

### 11.1 テスト構成

| テストタイプ | ファイル | 件数 | カバレッジ |
|------------|---------|------|-----------|
| Unit Tests | `tests/pipelines/test_gcalendar.py` | 12 | 認証, Transform, DB |
| Integration Tests | 同上 | 8 | API Fetch, Full Sync |
| **合計** | - | **20** | **~95%** |

### 11.2 主要テストケース

**Data Transformation (5件)**:
- `test_to_db_event`: 通常イベントの変換
- `test_to_db_event_all_day`: 終日イベントの変換
- `test_to_db_event_minimal`: 最小フィールド変換
- `test_to_db_event_recurring`: 繰り返しイベント（展開後）の変換
- `test_to_db_event_cancelled`: キャンセルイベントの変換

**Authentication (8件)**:
- `test_get_calendar_id`: カレンダーID取得
- `test_get_calendar_id_missing`: calendar_id欠損エラー
- `test_load_service_account_success`: サービスアカウント読み込み正常系
- `test_load_service_account_missing_json`: service_account_json欠損エラー
- `test_load_service_account_missing_client_email`: client_email欠損エラー
- `test_load_service_account_missing_private_key`: private_key欠損エラー
- `test_load_service_account_invalid_base64`: 不正なBase64形式エラー
- `test_load_service_account_invalid_json`: 不正なJSON形式エラー

**DB Operations (3件)**:
- `test_upsert_events_success`: 正常系
- `test_upsert_events_empty`: 空リスト
- `test_upsert_events_multiple`: 複数イベント保存

**Full Sync (4件)**:
- `test_sync_gcalendar_success`: エンドツーエンド
- `test_sync_gcalendar_date_range`: 日付範囲計算
- `test_sync_gcalendar_default_days`: デフォルト日数（7日）
- `test_sync_gcalendar_result_stats`: 同期結果の統計情報

### 11.3 テスト実行

```bash
# 全テスト実行
pytest tests/pipelines/test_gcalendar.py -v

# 特定カテゴリのテスト
pytest tests/pipelines/test_gcalendar.py -k "to_db_event" -v  # 変換
pytest tests/pipelines/test_gcalendar.py -k "calendar_id" -v  # 認証
pytest tests/pipelines/test_gcalendar.py -k "upsert" -v       # DB
pytest tests/pipelines/test_gcalendar.py -k "sync" -v         # 統合

# カバレッジ測定
pytest tests/pipelines/test_gcalendar.py --cov=pipelines.services.gcalendar
```

### 11.4 テストカバレッジ対応表

| 関数/クラス | テスト | カバレッジ |
|------------|--------|-----------|
| `get_calendar_id` | `test_get_calendar_id_*` (2件) | 100% |
| `load_service_account` | `test_load_service_account_*` (6件) | 100% |
| `to_db_event` | `test_to_db_event_*` (5件) | 100% |
| `upsert_events` | `test_upsert_events_*` (3件) | 100% |
| `sync_gcalendar` | `test_sync_gcalendar_*` (4件) | 100% |

## 12. 運用

### 12.1 実行方法

**手動実行**:
```bash
# 仮想環境アクティベート
source .venv/Scripts/activate

# 7日分同期（デフォルト）
python -c "import asyncio; from pipelines.services.gcalendar import sync_gcalendar; asyncio.run(sync_gcalendar(days=7))"

# 3日分同期
python -c "import asyncio; from pipelines.services.gcalendar import sync_gcalendar; asyncio.run(sync_gcalendar(days=3))"
```

**GitHub Actions（予定）**:
```yaml
# .github/workflows/sync-daily.yml
- name: Sync Google Calendar
  run: python -m pipelines.services.gcalendar
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
  "service_account_json": "{...Google Service Account JSON...}",
  "calendar_id": "your_calendar_id@group.calendar.google.com"
}
```

### 12.4 Google Cloud 設定

1. Google Cloud Console でプロジェクト作成
2. Calendar API を有効化
3. サービスアカウント作成、JSON キーをダウンロード
4. カレンダーの共有設定でサービスアカウントのメールアドレスを追加（読み取り権限）

### 12.5 ログ出力

```
[2025-12-01 12:01:53] INFO [gcalendar] Starting Google Calendar sync (3 days)
[2025-12-01 12:01:54] INFO [gcalendar] Fetching events (2025-11-28 to 2025-12-02)...
[2025-12-01 12:01:59] INFO [gcalendar] Fetched 107 events (2 HTTP requests in 5.26s)
[2025-12-01 12:01:59] INFO [gcalendar] Saving to database...
[2025-12-01 12:02:00] INFO [gcalendar] Saved 107 events to raw.gcalendar_events
[2025-12-01 12:02:00] INFO [gcalendar] Google Calendar sync completed in 5.77s: 107 fetched, 107 upserted
```

### 12.6 モニタリング

**監視項目**:
- 同期成功/失敗回数
- データ件数
- 処理時間

**アラート条件**:
- 3日連続同期失敗
- 処理時間が30秒超

## 13. 将来対応

### 13.1 短期（1-2ヶ月）

- [ ] GitHub Actions 統合
- [ ] Deno版との並行運用・データ整合性検証

### 13.2 中期（3-6ヶ月）

- [ ] キャンセルイベント検出（削除されたイベントの status 更新）
- [ ] 差分同期（`updatedMin` パラメータによる増分同期）

### 13.3 長期（6ヶ月以降）

- [ ] 複数カレンダー対応

## 14. Toggl との対応関係

### 14.1 フィールドマッピング

| GCalendar (予定) | Toggl (実績) | 備考 |
|------------------|--------------|------|
| description | client | プロジェクト/案件 |
| summary | description | 具体的な作業内容 |
| color_id | project.color | 時間の質的分類 |
| start_time / end_time | start / stop | 時間帯 |
| duration_ms | duration_ms | 期間（ミリ秒） |

### 14.2 予実比較ビュー（将来実装）

```sql
-- 日次予実比較
SELECT
  DATE(g.start_time) AS date,
  g.description AS client_name,
  SUM(g.duration_ms) AS planned_ms,
  SUM(t.duration_ms) AS actual_ms
FROM raw.gcalendar_events g
LEFT JOIN raw.toggl_entries t
  ON DATE(g.start_time) = DATE(t.start)
  AND g.description = t.client_name
WHERE g.status = 'confirmed'
GROUP BY DATE(g.start_time), g.description
```

## 15. 参考資料

### 15.1 外部ドキュメント

- [Google Calendar API](https://developers.google.com/calendar/api)
- [Service Account Authentication](https://developers.google.com/identity/protocols/oauth2/service-account)

### 15.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/` - DBスキーマ
- `tests/pipelines/test_gcalendar.py` - テストコード

## 16. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成。Deno版からPython版への移行完了 |
| 1.1.0 | 2025-12-01 | フォーマット統一（ADR形式、セクション構成） |

---

**ドキュメント終了**
