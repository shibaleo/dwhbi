# Zaim テスト

## ディレクトリ構成

```
test/zaim/
├── README.md              # このファイル
├── write_db.test.ts       # toDb* 変換関数（4種類）
├── check_api.ts           # API疎通確認
└── check_sync.ts          # 同期確認（⚠️ DB書き込みあり）
```

## 単体テスト（`*.test.ts`）

環境変数不要で実行可能。

```bash
# deno task を使用（推奨）
deno task test:zaim

# または直接実行
deno test test/zaim/ --allow-env --allow-read
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `write_db.test.ts` | 12件 | `toDbCategory`, `toDbGenre`, `toDbAccount`, `toDbTransaction` |
| **合計** | **12件** | |

### テスト観点

- 4種類のデータ変換関数
- 必須フィールドの変換
- `active` フラグの boolean 変換（`1` → `true`）
- オプショナルフィールドの null 変換
- `account_id = 0` の null 変換

## 手動確認スクリプト（`check_*.ts`）

実環境のAPI・DBに接続するため、環境変数が必要。

### 必要な環境変数

```
ZAIM_CONSUMER_KEY=xxxxx
ZAIM_CONSUMER_SECRET=xxxxx
ZAIM_ACCESS_TOKEN=xxxxx
ZAIM_ACCESS_TOKEN_SECRET=xxxxx
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

### 推奨実行順序

```bash
# 1. API疎通確認
deno run --allow-env --allow-net --allow-read test/zaim/check_api.ts

# 2. 同期確認（⚠️ DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/zaim/check_sync.ts
```

## トラブルシューティング

### OAuth認証エラー

```
❌ エラー: oauth_problem=signature_invalid
```

→ 環境変数の4つのトークンが正しいか確認。
