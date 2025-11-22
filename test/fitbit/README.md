# Fitbit テスト

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
| `auth.ts` | ✅ `isTokenExpiringSoon` | ✅ | 純粋関数 + 外部API依存部分 |
| `api.ts` | ✅ `formatFitbitDate`, `parseFitbitDate` | ✅ | ヘルパー関数 + 外部API依存部分 |
| `fetch_data.ts` | ✅ `generateDateRange`, `generatePeriods` | ✅ | 純粋関数 + API組み合わせ |
| `write_db.ts` | ✅ `toDb*`変換関数（8種類） | - | 純粋関数 |
| `sync_daily.ts` | ❌ | ✅ | オーケストレーター |
| `sync_all.ts` | ❌ | ✅ | オーケストレーター |

---

## ディレクトリ構成

```
test/fitbit/
├── README.md              # このファイル
├── api.test.ts            # formatFitbitDate, parseFitbitDate
├── auth.test.ts           # isTokenExpiringSoon
├── fetch_data.test.ts     # generateDateRange, generatePeriods
├── write_db.test.ts       # toDb* 変換関数（8種類）
├── run_tests.bat          # Windows用一括実行
├── run_tests.sh           # Unix用一括実行
└── manual/
    ├── README.md          # 手動テストの説明
    ├── test_auth.ts       # 認証フローテスト
    ├── test_fetch.ts      # API取得テスト（DB書き込みなし）
    ├── test_sync.ts       # 統合テスト（DB書き込みあり）
    └── check_db.ts        # DB内容確認
```

---

## 単体テスト

### 実行方法

```bash
# 全テスト実行
deno test test/fitbit/ --allow-env --allow-read

# 個別実行
deno test test/fitbit/api.test.ts --allow-env
deno test test/fitbit/auth.test.ts --allow-env
deno test test/fitbit/fetch_data.test.ts --allow-env
deno test test/fitbit/write_db.test.ts --allow-env --allow-read

# Windows一括実行
test\fitbit\run_tests.bat

# Unix一括実行
./test/fitbit/run_tests.sh
```

### テスト件数

| ファイル | 件数 | 対象 |
|----------|------|------|
| `api.test.ts` | 6件 | `formatFitbitDate`, `parseFitbitDate` |
| `auth.test.ts` | 10件 | `isTokenExpiringSoon` |
| `fetch_data.test.ts` | 10件 | `generateDateRange`, `generatePeriods` |
| `write_db.test.ts` | 24件 | `toDbSleep`, `toDbActivityDaily`, `toDbHeartRateDaily`, `toDbHrvDaily`, `toDbSpo2Daily`, `toDbBreathingRateDaily`, `toDbCardioScoreDaily`, `toDbTemperatureSkinDaily` |
| **合計** | **50件** | |

### テスト観点

#### api.test.ts
- `formatFitbitDate`: Date → YYYY-MM-DD 変換
- `parseFitbitDate`: YYYY-MM-DD → Date 変換

#### auth.test.ts
- 有効期限チェック（分単位の閾値）
- デフォルト閾値（60分）
- エッジケース（期限切れ、ちょうど閾値）

#### fetch_data.test.ts
- `generateDateRange`: 開始〜終了日のDate配列生成
- `generatePeriods`: 期間分割（Sleep: 100日、Temp: 30日）

#### write_db.test.ts
- 8種類のデータ変換関数
- 必須フィールドの変換
- オプショナルフィールドの処理
- JSONB格納フィールド（levels, heart_rate_zones, intraday等）
- VO2 Max範囲値パース（"30-35" → low/high/avg）

---

## 手動確認スクリプト

詳細は `manual/README.md` を参照。

### 推奨実行順序

```bash
# 1. 認証テスト
deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_auth.ts

# 2. データ取得テスト（DB書き込みなし）
deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_fetch.ts

# 3. DB内容確認
deno run --allow-env --allow-net --allow-read test/fitbit/manual/check_db.ts

# 4. 同期テスト（DB書き込みあり）
deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync.ts

# 5. DB内容確認（同期後）
deno run --allow-env --allow-net --allow-read test/fitbit/manual/check_db.ts
```

---

## 環境変数

テスト実行には以下の環境変数が必要です（`.env` または環境変数で設定）：

| 変数名 | 用途 | 単体テスト | 手動確認 |
|--------|------|-----------|----------|
| `SUPABASE_URL` | DB接続 | - | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | DB接続 | - | ✅ |
| `FITBIT_CLIENT_ID` | OAuth認証 | - | ✅ |
| `FITBIT_CLIENT_SECRET` | OAuth認証 | - | ✅ |

単体テスト（`*.test.ts`）は環境変数不要で実行可能です。

---

## Fitbit API レート制限に関する注意

- レート制限: 150リクエスト/時間
- 手動テスト時は `FITBIT_TEST_DAYS` を小さく設定（デフォルト: 3日）
- `test_fetch.ts` は1日あたり約10リクエスト消費
- 連続テスト時はレート制限に注意
