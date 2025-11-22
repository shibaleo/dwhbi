# Google Calendar テスト

## ディレクトリ構成

```
test/gcalendar/
├── README.md              # このファイル
├── write_db.test.ts       # transformEvent 変換関数
├── check_all.ts           # 一括確認スクリプト
├── check_api.ts           # API疎通確認
├── check_sync.ts          # 日次同期確認（⚠️ DB書き込みあり）
└── check_sync_all.ts      # 全件同期確認（⚠️ DB書き込みあり）
```

## 単体テスト（`*.test.ts`）

環境変数不要で実行可能。

```bash
# deno task を使用（推奨）
deno task test:gcalendar

# または直接実行
deno test test/gcalendar/ --allow-env --allow-read
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `write_db.test.ts` | 18件 | `transformEvent` |
| **合計** | **18件** | |

### テスト観点

- `transformEvent()`: GCalApiEvent → DbEvent 変換
- 通常イベント（dateTime）の変換
- 終日イベント（date → dateTime変換）
- オプショナルフィールドの null 変換
- status / colorId / recurring_event_id の変換
- is_all_day フラグの判定

## 手動確認スクリプト（`check_*.ts`）

実環境のAPI・DBに接続するため、環境変数が必要。

### 必要な環境変数

```
GOOGLE_CALENDAR_ID=xxxxx@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

### 推奨実行順序

```bash
# 1. API疎通確認
deno run --allow-env --allow-net --allow-read test/gcalendar/check_api.ts

# 2. 同期確認（直近7日、⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/gcalendar/check_sync.ts

# 3. 全件同期確認（特定期間、⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/gcalendar/check_sync_all.ts
```

### 期間指定

```bash
# 全件同期の期間を指定
GCAL_TEST_START=2025-01-01 GCAL_TEST_END=2025-12-31 \
  deno run --allow-env --allow-net --allow-read test/gcalendar/check_sync_all.ts
```

### CLIで直接実行

```bash
# ヘルプ表示
deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_all.ts --help

# 特定期間の同期
deno run --allow-env --allow-net --allow-read src/services/gcalendar/sync_all.ts --start=2025-11-01 --end=2025-11-22
```

## トラブルシューティング

### 認証エラー

```
❌ エラー: The caller does not have permission
```

→ サービスアカウントがカレンダーに共有されているか確認。

### 環境変数エラー

```
❌ エラー: GOOGLE_CALENDAR_ID is not set
```

→ 環境変数を確認してください。
