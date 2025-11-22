# Zaim テスト

## テスト方針

個人プロジェクトにおける工数対効果を考慮し、以下の方針でテストを構成しています。

### テスト対象の選定基準

| 種類 | 対象 | 採用 | 理由 |
|------|------|------|------|
| 単体テスト | 純粋関数（入力→出力が決定的） | ✅ | 回帰検知に有効、実装コスト低 |
| 統合テスト | 複数モジュールの連携 | ❌ | モック作成の工数が大きい |
| 手動確認スクリプト | 外部API・DB連携 | ✅ | 実環境での動作確認に実用的 |

### モジュール別テスト適用

| ファイル | 単体テスト | 手動確認 | 理由 |
|----------|-----------|----------|------|
| `types.ts` | - | - | 型定義のみ |
| `auth.ts` | ❌ | ✅ | 外部ライブラリのラッパー |
| `api.ts` | ❌ | ✅ | 外部API依存 |
| `fetch_data.ts` | ❌ | ✅ | api.tsの組み合わせ |
| `write_db.ts` | ✅ | - | `toDb*`変換関数は純粋関数 |
| `sync_daily.ts` | ❌ | ✅ | オーケストレーター |
| `sync_all_transactions.ts` | ❌ | ✅ | オーケストレーター |

---

## ディレクトリ構成

```
test/zaim/
├── README.md              # このファイル
├── write_db.test.ts       # 変換関数の単体テスト
└── manual/
    ├── check_api.ts       # API疎通確認
    └── check_sync.ts      # 同期動作確認（少量データ）
```

---

## 単体テスト

### 実行方法

```bash
deno test --allow-env test/zaim/write_db.test.ts
```

### テスト対象

`write_db.ts` の変換関数：

- `toDbCategory()` - ZaimCategory → DbCategory
- `toDbGenre()` - ZaimGenre → DbGenre
- `toDbAccount()` - ZaimAccount → DbAccount
- `toDbTransaction()` - ZaimTransaction → DbTransaction

### テスト観点

- 必須フィールドの変換
- `active` フラグの boolean 変換（`1` → `true`, `0` → `false`）
- オプショナルフィールドの null 変換
- `account_id = 0` の null 変換（toDbTransaction）

---

## 手動確認スクリプト

### check_api.ts

Zaim APIへの疎通確認。認証情報が正しく設定されているか、APIが応答するかを確認します。

```bash
deno run --allow-env --allow-net --allow-read test/zaim/manual/check_api.ts
```

### check_sync.ts

少量データでの同期動作確認。直近1日分のデータを取得し、DBへの書き込みをテストします。

```bash
deno run --allow-env --allow-net --allow-read test/zaim/manual/check_sync.ts
```

---

## 環境変数

テスト実行には以下の環境変数が必要です（`.env` または環境変数で設定）：

| 変数名 | 用途 |
|--------|------|
| `ZAIM_CONSUMER_KEY` | 手動確認スクリプト |
| `ZAIM_CONSUMER_SECRET` | 手動確認スクリプト |
| `ZAIM_ACCESS_TOKEN` | 手動確認スクリプト |
| `ZAIM_ACCESS_TOKEN_SECRET` | 手動確認スクリプト |
| `SUPABASE_URL` | check_sync.ts |
| `SUPABASE_SERVICE_ROLE_KEY` | check_sync.ts |

単体テスト（write_db.test.ts）は環境変数不要で実行可能です。
