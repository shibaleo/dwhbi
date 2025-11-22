# Toggl テスト

## ディレクトリ構成

```
test/toggl/
├── README.md              # このファイル
├── api.test.ts            # formatDate, getDateRange
├── sync_all.test.ts       # splitDateRange
├── write_db.test.ts       # toDb* 変換関数（4種類）
├── check_api.ts           # API疎通確認
├── check_reports_api.ts   # Reports API v3 疎通確認
├── check_sync.ts          # 同期確認（⚠️ DB書き込みあり）
└── check_all.ts           # 一括確認
```

## 単体テスト（`*.test.ts`）

環境変数不要で実行可能。

```bash
# deno task を使用（推奨）
deno task test:toggl

# または直接実行
deno test test/toggl/ --allow-env --allow-read
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `api.test.ts` | 11件 | `formatDate`, `getDateRange` |
| `sync_all.test.ts` | 9件 | `splitDateRange` |
| `write_db.test.ts` | 13件 | `toDbClient`, `toDbProject`, `toDbTag`, `toDbEntry` |
| **合計** | **33件** | |

### テスト観点

#### api.test.ts
- `formatDate`: Date → YYYY-MM-DD 変換
- `getDateRange`: 日付範囲計算（月またぎ、年またぎ）

#### sync_all.test.ts
- `splitDateRange`: 日付範囲を12か月単位のチャンクに分割
- 境界ケース（年またぎ、1か月未満、同一日）
- デフォルト値・カスタム値の確認

#### write_db.test.ts
- 4種類のデータ変換関数
- 必須フィールドの変換
- オプショナルフィールドの null/デフォルト変換
- duration 秒 → ミリ秒変換
- 実行中エントリー（duration < 0）のスキップ

## 手動確認スクリプト（`check_*.ts`）

実環境のAPI・DBに接続するため、環境変数が必要。

### 必要な環境変数

```
TOGGL_API_TOKEN=xxxxx
TOGGL_WORKSPACE_ID=xxxxx
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

### 推奨実行順序

```bash
# 1. API疎通確認（v9 API）
deno run --allow-env --allow-net --allow-read test/toggl/check_api.ts

# 2. Reports API v3 疎通確認（1-2 reqのみ）
deno run --allow-env --allow-net --allow-read test/toggl/check_reports_api.ts

# 3. 同期確認（⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/toggl/check_sync.ts
```

## レート制限

- Toggl API: 時間あたりの呼び出し制限あり
- 無料プランではリセットまで300秒（5分）待機が必要

## トラブルシューティング

### レート制限

```
❌ エラー: 402 Payment Required
```

→ 5分待つか、翌日に再実行。

### 認証エラー

```
❌ エラー: 403 Forbidden
```

→ TOGGL_API_TOKEN が正しいか確認。
