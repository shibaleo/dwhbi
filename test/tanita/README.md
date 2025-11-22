# Tanita テスト

## ディレクトリ構成

```
test/tanita/
├── README.md              # このファイル
├── api.test.ts            # formatTanitaDate, parseTanitaDate
├── auth.test.ts           # isTokenExpiringSoon
├── fetch_data.test.ts     # generatePeriods
├── write_db.test.ts       # toDb* 変換関数（3種類）
├── check_auth.ts          # 認証フロー確認
├── check_fetch.ts         # データ取得確認（DB書き込みなし）
├── check_sync.ts          # 日次同期確認（⚠️ DB書き込みあり）
└── check_db.ts            # DB内容確認
```

## 単体テスト（`*.test.ts`）

環境変数不要で実行可能。

```bash
# deno task を使用（推奨）
deno task test:tanita

# または直接実行
deno test test/tanita/ --allow-env --allow-read
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `api.test.ts` | 11件 | `formatTanitaDate`, `parseTanitaDate` |
| `auth.test.ts` | 10件 | `isTokenExpiringSoon` |
| `fetch_data.test.ts` | 10件 | `generatePeriods` |
| `write_db.test.ts` | 19件 | 3種類の `toDb*` 変換関数 |
| **合計** | **50件** | |

## 手動確認スクリプト（`check_*.ts`）

実環境のAPI・DBに接続するため、環境変数が必要。

### 必要な環境変数

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
TANITA_CLIENT_ID=xxxxx
TANITA_CLIENT_SECRET=xxxxx
```

### 推奨実行順序

```bash
# 1. 認証確認
deno run --allow-env --allow-net --allow-read test/tanita/check_auth.ts

# 2. データ取得確認（DB書き込みなし）
deno run --allow-env --allow-net --allow-read test/tanita/check_fetch.ts

# 3. DB内容確認（同期前）
deno run --allow-env --allow-net --allow-read test/tanita/check_db.ts

# 4. 同期確認（⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/tanita/check_sync.ts

# 5. DB内容確認（同期後）
deno run --allow-env --allow-net --allow-read test/tanita/check_db.ts
```

### 日数指定

```bash
# データ取得（30日間）
TANITA_TEST_DAYS=30 deno run --allow-env --allow-net --allow-read test/tanita/check_fetch.ts

# 同期（7日間）
TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/tanita/check_sync.ts
```

## トラブルシューティング

### トークンが期限切れ

```
❌ エラー: invalid_grant
```

→ 手動で新しいトークンを取得し、`tanita.tokens`テーブルを更新。
