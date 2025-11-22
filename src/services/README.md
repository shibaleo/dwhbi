# Services

外部APIからデータを取得し、Supabaseに同期するモジュール群。

## サービス一覧

| サービス | データソース | 同期先スキーマ | 概要 |
|----------|-------------|---------------|------|
| [fitbit](./fitbit/) | Fitbit Web API | `fitbit` | 睡眠・心拍・活動・HRV・SpO2等のヘルスデータ |
| [gcalendar](./gcalendar/) | Google Calendar API | `gcalendar` | 予定イベント（Togglとの予実管理用） |
| [tanita](./tanita/) | Tanita Health Planet API | `tanita` | 体組成・血圧・歩数 |
| [toggl](./toggl/) | Toggl Track API | `toggl` | 時間記録（実績） |
| [zaim](./zaim/) | Zaim API | `zaim` | 家計簿（収支・口座） |

## 共通アーキテクチャ

各サービスは同一のファイル構成に従う:

```
{service}/
├── types.ts        # API型・DB型定義
├── auth.ts         # 認証（OAuth/Basic）
├── api.ts          # APIクライアント
├── fetch_data.ts   # データ取得オーケストレーション
├── write_db.ts     # DB書き込み（変換・upsert）
├── sync_daily.ts   # 日次同期（実行可能）
├── sync_all.ts     # 全件同期（実行可能、一部サービス）
└── README.md       # サービス固有ドキュメント
```

## 共通環境変数

全サービスで必須:

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |

## 日付範囲の計算パターン

全サービス共通:

```typescript
// endDate = 明日（APIは排他的終点のため）
const endDate = new Date();
endDate.setDate(endDate.getDate() + 1);

// startDate = endDate - (days + 1)
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - days - 1);
```

## GitHub Actions

毎日 JST 00:00 に `src/sync_all.ts` で全サービスを並列同期。

詳細は各サービスの README.md を参照。
