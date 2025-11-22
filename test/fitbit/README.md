# Fitbit テスト

## ディレクトリ構成

```
test/fitbit/
├── README.md              # このファイル
├── api.test.ts            # formatFitbitDate, parseFitbitDate
├── auth.test.ts           # isTokenExpiringSoon
├── fetch_data.test.ts     # generateDateRange, generatePeriods
├── write_db.test.ts       # toDb* 変換関数（8種類）
├── check_auth.ts          # 認証フロー確認
├── check_fetch.ts         # データ取得確認（DB書き込みなし）
├── check_sync.ts          # 日次同期確認（⚠️ DB書き込みあり）
├── check_sync_all.ts      # 全件同期確認（⚠️ DB書き込みあり）
└── check_db.ts            # DB内容確認
```

## 単体テスト（`*.test.ts`）

環境変数不要で実行可能。

```bash
# deno task を使用（推奨）
deno task test:fitbit

# または直接実行
deno test test/fitbit/ --allow-env --allow-read
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `api.test.ts` | 6件 | `formatFitbitDate`, `parseFitbitDate` |
| `auth.test.ts` | 10件 | `isTokenExpiringSoon` |
| `fetch_data.test.ts` | 10件 | `generateDateRange`, `generatePeriods` |
| `write_db.test.ts` | 24件 | 8種類の `toDb*` 変換関数 |
| **合計** | **50件** | |

## 手動確認スクリプト（`check_*.ts`）

実環境のAPI・DBに接続するため、環境変数が必要。

### 必要な環境変数

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
FITBIT_CLIENT_ID=xxxxx
FITBIT_CLIENT_SECRET=xxxxx
```

### 推奨実行順序

```bash
# 1. 認証確認
deno run --allow-env --allow-net --allow-read test/fitbit/check_auth.ts

# 2. データ取得確認（DB書き込みなし）
deno run --allow-env --allow-net --allow-read test/fitbit/check_fetch.ts

# 3. DB内容確認（同期前）
deno run --allow-env --allow-net --allow-read test/fitbit/check_db.ts

# 4. 同期確認（⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/fitbit/check_sync.ts

# 5. DB内容確認（同期後）
deno run --allow-env --allow-net --allow-read test/fitbit/check_db.ts
```

### 日数指定

```bash
# データ取得（7日間）
FITBIT_TEST_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/check_fetch.ts

# 同期（7日間）
FITBIT_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/check_sync.ts
```

### 全件同期

```bash
# 期間指定で全件同期
FITBIT_TEST_START=2020-04-01 FITBIT_TEST_END=2020-10-31 \
  deno run --allow-env --allow-net --allow-read test/fitbit/check_sync_all.ts
```

## レート制限

- Fitbit API: **150リクエスト/時間**
- `check_fetch.ts` は1日あたり約10リクエスト消費
- 3日間テストで約30リクエスト

## トラブルシューティング

### トークンが期限切れ

```
❌ リフレッシュエラー: 401 - {"errors":[{"errorType":"expired_token"...}]}
```

→ 手動で新しいトークンを取得し、`fitbit.tokens`テーブルを更新。

### レート制限

```
❌ Fitbit API エラー: 429 - Too Many Requests
```

→ 1時間待つか、翌日に再実行。
