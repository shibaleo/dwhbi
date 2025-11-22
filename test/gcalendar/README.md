# Google Calendar テスト

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
| `auth.ts` | ❌ | ✅ | 外部API依存（JWT認証） |
| `api.ts` | ❌ | ✅ | 外部API依存 |
| `fetch_events.ts` | ✅ | - | `transformEvent()`は純粋関数 |
| `write_db.ts` | ❌ | ✅ | DB依存 |
| `sync_daily.ts` | ❌ | ✅ | オーケストレーター |

---

## ディレクトリ構成

```
test/gcalendar/
├── README.md                  # このファイル
├── fetch_events.test.ts       # 変換関数の単体テスト
└── manual/
    ├── check_api.ts           # API疎通確認
    └── check_sync.ts          # 同期動作確認（少量データ）
```

---

## 単体テスト

### 実行方法

```bash
deno test test/gcalendar/fetch_events.test.ts
```

### テスト対象

`fetch_events.ts` の変換関数：

- `transformEvent()` - GCalApiEvent → DbEvent

### テスト観点

- 通常イベント（dateTime）の変換
- 終日イベント（date → dateTimeへの変換）
- オプショナルフィールドの null 変換
- status / colorId の変換
- recurring_event_id の変換
- is_all_day フラグの判定

---

## 手動確認スクリプト

### check_api.ts

Google Calendar APIへの疎通確認。サービスアカウント認証が正しく設定されているか、APIが応答するかを確認します。

```bash
deno run --allow-env --allow-net --allow-read test/gcalendar/manual/check_api.ts
```

### check_sync.ts

少量データでの同期動作確認。直近7日分のデータを取得し、DBへの書き込みをテストします。

```bash
deno run --allow-env --allow-net --allow-read test/gcalendar/manual/check_sync.ts
```

---

## 環境変数

テスト実行には以下の環境変数が必要です（`.env` または環境変数で設定）：

| 変数名 | 用途 |
|--------|------|
| `GOOGLE_CALENDAR_ID` | 手動確認スクリプト |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 手動確認スクリプト |
| `SUPABASE_URL` | check_sync.ts |
| `SUPABASE_SERVICE_ROLE_KEY` | check_sync.ts |

単体テスト（fetch_events.test.ts）は環境変数不要で実行可能です。
