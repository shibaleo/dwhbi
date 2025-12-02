---
title: TickTick 同期モジュール詳細設計
---


| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.0.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/ticktick.py` |
| ステータス | 実装完了 |

## 1. 概要

### 1.1 目的

TickTick Open API を使用してプロジェクト、タスク、完了済みタスクのデータを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- プロジェクト（タスクリスト）の同期
- アクティブなタスクの同期
- 完了済みタスクの日付範囲指定取得
- OAuth2 アクセストークンの自動リフレッシュ
- 日次バッチ処理（GitHub Actions から実行）
- raw 層への生データ保存

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| プロジェクト | TickTick のタスクリスト。複数のタスクを含む |
| タスク | 個別の ToDo 項目 |
| 完了済みタスク | status=2 のタスク（アーカイブ用に別テーブル保存） |
| OAuth2 | Authorization Code Flow による認証方式 |
| access_token | API アクセス用トークン（有効期限あり） |
| refresh_token | access_token 更新用トークン |
| upsert | INSERT or UPDATE（重複時は更新） |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| ネットワーク | TickTick API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| TickTick Open API | データ取得元 | 明示的な制限なし（0.1秒間隔で安全策） |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに TickTick OAuth2 認証情報が保存されていること
3. `raw.ticktick_*` テーブルが作成済みであること
4. 仮想環境がアクティベートされていること
5. OAuth2 認証フローが完了していること（`init_ticktick_oauth.py` 実行済み）

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| 完了タスクの日付制限 | 完了タスクは日付範囲指定が必須 | days パラメータで期間指定 |
| サブタスク | items として JSONB 保存 | staging層で展開 |
| refresh_token | TickTick が返さない場合あり | access_token の有効期限内は不要 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌─────────────────────────────────────────────────────────────┐
│                    sync_ticktick()                          │
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
│ credentials     │  │ TickTick API    │  │   Supabase      │
│ (OAuth2管理)     │  │   (外部API)      │  │   raw.*         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── ticktick.py       # 本モジュール（TickTick専用ロジック、約500行）
├── lib/
│   ├── credentials.py    # 認証情報の取得・復号・更新
│   ├── db.py             # Supabaseクライアント
│   ├── encryption.py     # AES-GCM暗号化
│   └── logger.py         # ロギング設定
└── scripts/
    └── init_ticktick_oauth.py  # OAuth2 初期認証フロー
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_ticktick(days) 呼び出し
   │
   ├─ 2. 認証
   │   ├─ get_access_token() 呼び出し
   │   ├─ キャッシュ確認 → 有効ならキャッシュから返却
   │   ├─ DB から認証情報取得
   │   ├─ 有効期限チェック（60分閾値）
   │   │   ├─ 有効期限内 → トークンをキャッシュして返却
   │   │   └─ 期限切れ → refresh_access_token() でリフレッシュ
   │   └─ 新トークンを DB に保存
   │
   ├─ 3. データ取得（HTTPクライアント共有）
   │   ├─ fetch_projects() → GET /project
   │   │   └─ プロジェクト一覧を取得
   │   │
   │   └─ 各プロジェクトに対して:
   │       ├─ fetch_project_tasks() → GET /project/{id}/data
   │       │   └─ アクティブなタスクを取得
   │       └─ fetch_completed_tasks() → GET /project/{id}/completed
   │           └─ 指定日数分の完了タスクを取得
   │
   ├─ 4. 型変換（API型 → DB型）
   │   ├─ to_db_project()
   │   └─ to_db_task()
   │
   └─ 5. DB保存
       ├─ upsert_projects()        → raw.ticktick_projects
       ├─ upsert_tasks()           → raw.ticktick_tasks
       └─ upsert_completed_tasks() → raw.ticktick_completed_tasks
```

### 4.2 OAuth2 トークン管理フロー

```
┌─────────────────────────────────────────────────────────────┐
│                 トークン管理フロー                           │
└─────────────────────────────────────────────────────────────┘

1. get_access_token(force_refresh=False) 呼び出し
   │
   ├─ メモリキャッシュ確認
   │   └─ 有効期限 > 60分 → キャッシュから返却
   │
   ├─ DB から認証情報取得
   │   └─ get_credentials("ticktick")
   │
   ├─ 必須フィールド確認
   │   ├─ client_id ✓
   │   ├─ client_secret ✓
   │   └─ access_token ✓
   │
   ├─ 有効期限チェック
   │   ├─ 有効期限まで > 60分 → キャッシュして返却
   │   └─ 有効期限まで ≤ 60分 → リフレッシュ必要
   │
   └─ リフレッシュ実行（refresh_token が必要）
       ├─ POST /oauth/token (grant_type=refresh_token)
       ├─ 新トークンを DB に保存
       └─ キャッシュ更新して返却

2. 初回認証フロー（init_ticktick_oauth.py）
   │
   ├─ ブラウザで認証画面を開く
   │   └─ GET /oauth/authorize?access_type=offline
   │
   ├─ ローカルサーバーでコールバック受信
   │   └─ http://localhost:8765/callback?code=xxx
   │
   ├─ 認証コードをトークンに交換
   │   └─ POST /oauth/token (grant_type=authorization_code)
   │
   └─ 認証情報を暗号化して DB に保存
```

### 4.3 レート制限対策

```python
# 各プロジェクトのタスク取得後に 0.1秒待機
for project in all_projects:
    tasks = await fetch_project_tasks(client, token, project_id)
    completed = await fetch_completed_tasks(client, token, project_id, ...)
    await asyncio.sleep(0.1)  # レート制限対策
```

## 5. 設計判断（ADR）

### ADR-001: OAuth2 認証方式

**決定**: Authorization Code Flow with Offline Access

**理由**:
- TickTick Open API は OAuth2 のみサポート
- `access_type=offline` で refresh_token を取得
- 長期間のバッチ処理に対応

**トレードオフ**:
- OK: セキュアな認証、自動トークン更新
- 注意: 初回認証にブラウザ操作が必要

### ADR-002: トークンのメモリキャッシュ

**決定**: モジュールレベル変数で access_token をキャッシュ

**理由**:
- 1回の同期中に複数回トークンを使用
- 毎回 DB アクセス + 復号は非効率
- 有効期限チェック付きで安全

**トレードオフ**:
- OK: パフォーマンス向上
- 注意: テスト時は `reset_cache()` が必要

### ADR-003: 完了タスクの別テーブル保存

**決定**: `ticktick_completed_tasks` として別テーブルに保存

**理由**:
- 完了タスクは参照専用（アーカイブ目的）
- アクティブタスクとのクエリ分離
- 日付範囲指定での差分取得を想定

**トレードオフ**:
- OK: クエリの明確化
- 注意: 同一タスクが両テーブルに存在する可能性

### ADR-004: 順次取得（並列なし）

**決定**: プロジェクトごとに順次取得（0.1秒間隔）

**理由**:
- TickTick API のレート制限が不明確
- 安全策として順次実行
- プロジェクト数が少ない想定

**代替案**:
- 並列取得 → レート制限リスク

### ADR-005: refresh_token なし対応

**決定**: access_token が有効期限内であれば refresh_token なしでも動作

**理由**:
- TickTick は refresh_token を返さない場合がある
- access_token の有効期限が長い（約6ヶ月）
- 有効期限切れ時のみ再認証を要求

**トレードオフ**:
- OK: 柔軟な運用
- 注意: 有効期限切れ時に手動再認証が必要

## 6. データ型定義

### 6.1 API型

```python
class OAuth2Credentials(TypedDict):
    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    token_type: str
    scope: str

class TickTickProject(TypedDict):
    id: str
    name: str
    color: str | None
    sortOrder: int | None
    sortType: str | None
    viewMode: str | None
    kind: str | None
    isOwner: bool | None
    closed: bool | None
    groupId: str | None

class TickTickTask(TypedDict):
    id: str
    projectId: str | None
    title: str
    content: str | None
    desc: str | None
    priority: int
    status: int
    sortOrder: int | None
    startDate: str | None
    dueDate: str | None
    completedTime: str | None
    timeZone: str | None
    isAllDay: bool | None
    reminder: str | None
    reminders: list[dict] | None
    repeatFlag: str | None
    tags: list[str] | None
    items: list[dict] | None
    progress: int | None
    kind: str | None
    createdTime: str | None
    modifiedTime: str | None
```

### 6.2 DB型

```python
class DbProject(TypedDict):
    id: str
    name: str
    color: str | None
    sort_order: int | None
    sort_type: str | None
    view_mode: str | None
    kind: str | None
    is_owner: bool | None
    closed: bool | None
    group_id: str | None

class DbTask(TypedDict):
    id: str
    project_id: str | None
    title: str
    content: str | None
    description: str | None
    priority: int
    status: int
    sort_order: int | None
    start_date: str | None
    due_date: str | None
    completed_time: str | None
    timezone: str | None
    is_all_day: bool | None
    reminder: str | None
    reminders: list[dict] | None
    repeat_flag: str | None
    tags: list[str] | None
    items: list[dict] | None
    progress: int | None
    kind: str | None
    created_time: str | None
    modified_time: str | None
```

### 6.3 結果型

```python
class SyncStats(TypedDict):
    projects: int
    tasks: int
    completed_tasks: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | メソッド | 説明 |
|---------|-------------|---------|------|
| Projects | `/open/v1/project` | GET | プロジェクト一覧 |
| Tasks | `/open/v1/project/{id}/data` | GET | プロジェクト内のタスク |
| Completed | `/open/v1/project/{id}/completed` | GET | 完了済みタスク |
| Token | `/oauth/token` | POST | トークン取得/更新 |

### 7.2 認証

**OAuth2 Bearer Token**

```
Authorization: Bearer {access_token}
```

### 7.3 リクエストパラメータ

**完了タスク取得**:

| パラメータ | 説明 | 形式 |
|-----------|------|------|
| from | 開始日時 | YYYY-MM-DDTHH:mm:ss+0000 |
| to | 終了日時 | YYYY-MM-DDTHH:mm:ss+0000 |

**トークンリフレッシュ**:

| パラメータ | 説明 |
|-----------|------|
| client_id | クライアントID |
| client_secret | クライアントシークレット |
| refresh_token | リフレッシュトークン |
| grant_type | "refresh_token" |

### 7.4 レスポンス例

**プロジェクト一覧**:
```json
[
  {
    "id": "abc123",
    "name": "Daily Routine",
    "color": "#4772FA",
    "sortOrder": 0,
    "viewMode": "list",
    "kind": "TASK",
    "isOwner": true,
    "closed": false
  }
]
```

**タスク取得 (/project/{id}/data)**:
```json
{
  "tasks": [
    {
      "id": "task123",
      "projectId": "abc123",
      "title": "Morning exercise",
      "priority": 0,
      "status": 0,
      "dueDate": "2025-12-01T09:00:00.000+0000"
    }
  ]
}
```

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.ticktick_projects` | `id` | プロジェクト |
| `raw.ticktick_tasks` | `id` | アクティブなタスク |
| `raw.ticktick_completed_tasks` | `id` | 完了済みタスク |

### 8.2 テーブル定義

**raw.ticktick_projects**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (TickTick Project ID) |
| name | TEXT | NO | - | プロジェクト名 |
| color | TEXT | YES | - | プロジェクトの色 |
| sort_order | BIGINT | YES | - | 並び順 |
| sort_type | TEXT | YES | - | ソート種類 |
| view_mode | TEXT | YES | - | 表示モード（list, kanban等） |
| kind | TEXT | YES | - | プロジェクトの種類 |
| is_owner | BOOLEAN | YES | true | オーナーかどうか |
| closed | BOOLEAN | YES | false | アーカイブ済みか |
| group_id | TEXT | YES | - | グループID |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.ticktick_tasks**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK (TickTick Task ID) |
| project_id | TEXT | YES | - | FK → ticktick_projects.id |
| title | TEXT | NO | - | タスク名 |
| content | TEXT | YES | - | タスク内容（マークダウン） |
| description | TEXT | YES | - | タスク説明 |
| priority | INTEGER | YES | 0 | 優先度（0:なし, 1:低, 3:中, 5:高） |
| status | INTEGER | YES | 0 | ステータス（0:未完了, 2:完了） |
| sort_order | BIGINT | YES | - | 並び順 |
| start_date | TIMESTAMPTZ | YES | - | 開始日時 |
| due_date | TIMESTAMPTZ | YES | - | 期限日時 |
| completed_time | TIMESTAMPTZ | YES | - | 完了日時 |
| timezone | TEXT | YES | - | タイムゾーン |
| is_all_day | BOOLEAN | YES | false | 終日タスクか |
| reminder | TEXT | YES | - | リマインダー |
| reminders | JSONB | YES | - | リマインダー配列 |
| repeat_flag | TEXT | YES | - | 繰り返し設定 |
| tags | TEXT[] | YES | - | タグの配列 |
| items | JSONB | YES | - | サブタスク情報 |
| progress | INTEGER | YES | 0 | 進捗率（0-100） |
| kind | TEXT | YES | - | タスクの種類 |
| created_time | TIMESTAMPTZ | YES | - | 作成日時 |
| modified_time | TIMESTAMPTZ | YES | - | 更新日時 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

**raw.ticktick_completed_tasks**:

| カラム | 型 | NULL | デフォルト | 説明 |
|--------|-----|------|-----------|------|
| id | TEXT | NO | - | PK |
| project_id | TEXT | YES | - | プロジェクトID |
| title | TEXT | NO | - | タスク名 |
| content | TEXT | YES | - | タスク内容 |
| description | TEXT | YES | - | タスク説明 |
| priority | INTEGER | YES | 0 | 優先度 |
| status | INTEGER | YES | 2 | ステータス（完了=2） |
| start_date | TIMESTAMPTZ | YES | - | 開始日時 |
| due_date | TIMESTAMPTZ | YES | - | 期限日時 |
| completed_time | TIMESTAMPTZ | NO | - | 完了日時（必須） |
| timezone | TEXT | YES | - | タイムゾーン |
| is_all_day | BOOLEAN | YES | false | 終日タスクか |
| tags | TEXT[] | YES | - | タグの配列 |
| items | JSONB | YES | - | サブタスク情報 |
| created_time | TIMESTAMPTZ | YES | - | 作成日時 |
| modified_time | TIMESTAMPTZ | YES | - | 更新日時 |
| synced_at | TIMESTAMPTZ | YES | now() | 同期日時 |

### 8.3 インデックス

```sql
-- Tasks
CREATE INDEX idx_ticktick_tasks_project_id ON raw.ticktick_tasks(project_id);
CREATE INDEX idx_ticktick_tasks_status ON raw.ticktick_tasks(status);
CREATE INDEX idx_ticktick_tasks_due_date ON raw.ticktick_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_ticktick_tasks_priority ON raw.ticktick_tasks(priority) WHERE priority > 0;
CREATE INDEX idx_ticktick_tasks_completed_time ON raw.ticktick_tasks(completed_time) WHERE completed_time IS NOT NULL;
CREATE INDEX idx_ticktick_tasks_tags ON raw.ticktick_tasks USING GIN(tags) WHERE tags IS NOT NULL;

-- Completed Tasks
CREATE INDEX idx_ticktick_completed_tasks_project_id ON raw.ticktick_completed_tasks(project_id);
CREATE INDEX idx_ticktick_completed_tasks_completed_time ON raw.ticktick_completed_tasks(completed_time);
```

### 8.4 外部キー制約

```sql
ALTER TABLE raw.ticktick_tasks
  ADD CONSTRAINT ticktick_tasks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES raw.ticktick_projects(id);
```

## 9. エラーハンドリング

### 9.1 エラー分類

| エラータイプ | 検出方法 | 対処 |
|------------|---------|------|
| 認証エラー | 401 | トークンリフレッシュ試行、失敗なら再認証 |
| 認証情報不足 | ValueError | credentials.services を確認 |
| Not Found | 404 | 空リストを返却（プロジェクトが空の場合） |
| サーバーエラー | 500系 | リトライ可能 |
| タイムアウト | httpx.TimeoutException | 60秒、ログ記録 |

### 9.2 例外一覧

| 例外 | 発生条件 | 対処法 |
|------|---------|--------|
| `ValueError` | client_id/client_secret/access_token 未設定 | OAuth2 認証を実行 |
| `ValueError` | refresh_token なしで期限切れ | 再認証が必要 |
| `RuntimeError` | トークンリフレッシュ失敗 | ログ確認、再認証 |
| `httpx.HTTPStatusError` | APIエラー | ステータスコードを確認 |
| `httpx.TimeoutException` | タイムアウト（60秒） | ネットワーク確認 |

## 10. パフォーマンス

### 10.1 ベンチマーク（3プロジェクト、13タスクの場合）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| 認証情報取得 | <1秒 | 0 |
| プロジェクト一覧取得 | ~1秒 | 1 |
| 各プロジェクトのタスク取得 | ~2秒 | 6 (3×2) |
| データ変換 | <1秒 | 0 |
| DB保存 | ~1.5秒 | 3 |
| **合計** | **~5.7秒** | **10** |

### 10.2 計測指標

| 指標 | 説明 | 目標値 |
|------|------|--------|
| HTTP リクエスト数 | TickTick API への呼び出し回数 | 1 + (プロジェクト数×2) |
| fetch 時間 | API 取得の合計時間 | < 5秒 |
| db 時間 | DB 保存の合計時間 | < 3秒 |
| 合計時間 | 同期全体の時間 | < 10秒 |

### 10.3 最適化手法

1. **トークンのメモリキャッシュ**: DB アクセス削減
2. **HTTPクライアント共有**: コネクション再利用
3. **0.1秒間隔待機**: レート制限回避の安全策
4. **upsert**: 存在チェック不要

## 11. 運用

### 11.1 実行方法

**OAuth2 初期認証**:
```bash
# 初回のみ実行（ブラウザで認証）
python scripts/init_ticktick_oauth.py
```

**手動同期**:
```bash
# デフォルト（7日分の完了タスク）
python -m pipelines.services.ticktick

# カスタム日数
python -c "
import asyncio
from pipelines.services.ticktick import sync_ticktick
asyncio.run(sync_ticktick(days=30))
"
```

**GitHub Actions**:
```yaml
# .github/workflows/sync-ticktick.yml
- name: Sync TickTick
  env:
    TICKTICK_SYNC_DAYS: ${{ inputs.sync_days || '7' }}
  run: |
    python -c "
    import asyncio
    import os
    from pipelines.services.ticktick import sync_ticktick
    days = int(os.environ.get('TICKTICK_SYNC_DAYS', '7'))
    asyncio.run(sync_ticktick(days=days))
    "
```

### 11.2 必要な環境変数

`.env` ファイルに設定：

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=...
TICKTICK_CLIENT_ID=your_client_id      # OAuth2 初期認証用
TICKTICK_CLIENT_SECRET=your_client_secret  # OAuth2 初期認証用
```

### 11.3 認証情報の設定

`credentials.services` テーブルに保存（暗号化済み、init_ticktick_oauth.py で自動設定）：

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "access_token": "xxx-xxx-xxx",
  "refresh_token": "yyy-yyy-yyy",
  "token_type": "Bearer",
  "scope": "tasks:read tasks:write"
}
```

### 11.4 ログ出力

```
[2025-12-01 21:35:01] INFO [ticktick] Starting TickTick sync (completed tasks: last 7 days)
[2025-12-01 21:35:03] INFO [ticktick] Fetching projects...
[2025-12-01 21:35:04] INFO [ticktick] Fetched 3 projects
[2025-12-01 21:35:04] INFO [ticktick] Fetching tasks...
[2025-12-01 21:35:05] INFO [ticktick] Project 'Daily Routine': 9 tasks, 0 completed
[2025-12-01 21:35:05] INFO [ticktick] Project 'Routine Tasks': 4 tasks, 0 completed
[2025-12-01 21:35:06] INFO [ticktick] Project 'Ad-hoc Tasks': 0 tasks, 0 completed
[2025-12-01 21:35:06] INFO [ticktick] Fetched 3 projects, 13 tasks, 0 completed tasks
[2025-12-01 21:35:06] INFO [ticktick] Saving to database...
[2025-12-01 21:35:06] INFO [ticktick] Saved 3 projects to raw.ticktick_projects
[2025-12-01 21:35:07] INFO [ticktick] Saved 13 tasks to raw.ticktick_tasks
[2025-12-01 21:35:07] INFO [ticktick] TickTick sync completed in 5.72s (db: 1.39s)
```

### 11.5 トラブルシューティング

**トークン期限切れエラー**:
```
ValueError: Token expired and no refresh_token available. Please re-authenticate.
```
→ `python scripts/init_ticktick_oauth.py` を再実行

**認証情報確認**:
```bash
python scripts/debug_ticktick_credentials.py
```

## 12. セキュリティ

### 12.1 認証情報の保護

- OAuth2 トークンは AES-GCM で暗号化して保存
- `TOKEN_ENCRYPTION_KEY` は環境変数から取得
- GitHub Actions では Secrets として管理

### 12.2 スコープ

| スコープ | 説明 |
|---------|------|
| tasks:read | タスク・プロジェクトの読み取り |
| tasks:write | タスク・プロジェクトの書き込み（将来用） |

## 13. 将来対応

### 13.1 短期（1-2ヶ月）

- [x] OAuth2 自動リフレッシュ
- [x] GitHub Actions 統合
- [ ] 習慣タスク (Habits) の取得

### 13.2 中期（3-6ヶ月）

- [ ] タグ情報の正規化
- [ ] サブタスク (items) の正規化

### 13.3 長期（6ヶ月以降）

- [ ] Webhook によるリアルタイム同期
- [ ] 双方向同期（Supabase → TickTick）

## 14. 参考資料

### 14.1 外部ドキュメント

- [TickTick Open API](https://developer.ticktick.com/api)
- [TickTick Developer Portal](https://developer.ticktick.com/)

### 14.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/20251201020000_create_ticktick_tables.sql` - DBスキーマ
- `scripts/init_ticktick_oauth.py` - OAuth2 初期認証スクリプト
- `scripts/debug_ticktick_credentials.py` - 認証情報デバッグスクリプト

## 15. 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成 |

---

**ドキュメント終了**
