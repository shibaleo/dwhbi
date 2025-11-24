# supabase-sync-jobs

LIFETRACER の中核となるデータ同期基盤。複数の外部サービスから個人データを取得し、Supabase（PostgreSQL）に統合保存する。

![system config](./docs/img/system_config.png)

## 概要

60年以上の長期データ保持と自己理解を目的とした個人データエコシステム。各サービスの専用ツールを活用しつつ、データは Supabase に集約し、ベンダー非依存の分析基盤を構築する。

### データソース

| サービス | 用途 | スキーマ |
|----------|------|---------|
| [Toggl](src/services/toggl/) | 時間記録（実績） | `toggl` |
| [Google Calendar](src/services/gcalendar/) | 予定（計画） | `gcalendar` |
| [Fitbit](src/services/fitbit/) | 睡眠・心拍・活動 | `fitbit` |
| [Tanita](src/services/tanita/) | 体組成・血圧 | `tanita` |
| [Zaim](src/services/zaim/) | 家計簿 | `zaim` |

## クイックスタート

### 環境変数

```bash
# 共通（必須）
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx

# 各サービス固有（詳細は各READMEを参照）
```

### 実行

```bash
# 全サービス日次同期
deno run --allow-env --allow-net --allow-read src/sync_all.ts

# 個別サービス同期
deno run --allow-env --allow-net --allow-read src/services/toggl/sync_daily.ts
deno run --allow-env --allow-net --allow-read src/services/fitbit/sync_daily.ts
```

### テスト

```bash
# 全単体テスト（154件）
deno task test

# 環境確認（API疎通、DB書き込みなし）
deno task check

# 同期確認（⚠️ DB書き込みあり）
deno task check:sync
```

## ディレクトリ構成

```
supabase-sync-jobs/
├── src/
│   ├── services/           # サービス別モジュール
│   │   ├── fitbit/         # Fitbit 同期
│   │   ├── gcalendar/      # Google Calendar 同期
│   │   ├── tanita/         # Tanita 同期
│   │   ├── toggl/          # Toggl 同期
│   │   └── zaim/           # Zaim 同期
│   ├── utils/              # 共通ユーティリティ
│   └── sync_all.ts         # 全サービス並列同期
├── test/                   # テストスイート
├── supabase/               # マイグレーション
├── .github/workflows/      # GitHub Actions
└── deno.json               # タスク定義
```

## アーキテクチャ

### サービス共通構成

各サービスは統一されたファイル構成に従う:

| ファイル | 責務 |
|----------|------|
| `types.ts` | API型・DB型定義 |
| `auth.ts` | 認証（OAuth/Basic） |
| `api.ts` | APIクライアント |
| `fetch_data.ts` | データ取得オーケストレーション |
| `write_db.ts` | DB書き込み（変換・upsert） |
| `sync_daily.ts` | 日次同期（実行可能） |
| `sync_all.ts` | 全件同期（実行可能、一部サービス） |

### データフロー

```
sync_daily.ts / sync_all.ts（オーケストレーター）
    │  同期日数決定、OAuth トークン確認、エラーハンドリング
    ▼
fetch_data.ts（データ取得層）
    │  日付範囲計算、チャンク分割、レート制限対応
    ▼
api.ts（APIクライアント層）
    │  外部APIリクエスト、auth.tsから認証情報取得
    ▼
write_db.ts（DB書き込み層）
       API型→DB型変換、バッチupsert
```

### 認証パターン

| パターン | サービス | 認証方式 | トークン管理 |
|----------|----------|----------|-------------|
| A | fitbit, tanita | OAuth 2.0 | Supabase DB |
| B | gcalendar | Service Account (JWT) | メモリキャッシュ |
| C | toggl, zaim | Basic / OAuth 1.0a | 環境変数 |

### 主要な設計パターン

**型命名規則:**
- APIレスポンス型: `{Service}Api{Entity}` (例: `FitbitApiSleepResponse`)
- DBテーブル型: `Db{Entity}` (例: `DbSleep`)

**バッチupsert:** 全サービスで `BATCH_SIZE = 1000` で統一。

**レート制限対応:** サービス固有のエラークラス (`FitbitRateLimitError` 等) で待機・リトライ。

詳細: [src/services/README.md](src/services/README.md)

### データベース設計

サービス別スキーマ + 統合ビューのアーキテクチャ:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ fitbit.*    │  │ toggl.*     │  │ zaim.*      │
│ (生データ)  │  │ (生データ)  │  │ (生データ)  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
                ┌───────────────┐
                │  public.*     │
                │  (統合ビュー) │
                └───────────────┘
```

これによりベンダー切替時も `public` スキーマのAPIは安定。

### 日付範囲の計算パターン

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

毎日 JST 00:00 に `sync-all.yml` で全サービスを並列同期。

| ワークフロー | スケジュール | 用途 |
|--------------|--------------|------|
| `sync-all.yml` | 毎日 JST 00:00 | 全サービス並列同期（推奨） |
| `sync-*.yml` | 手動のみ | 個別サービス同期 |

詳細: [.github/workflows/README.md](.github/workflows/README.md)

## テスト

### 単体テスト件数

| サービス | 件数 |
|----------|------|
| Fitbit | 50 |
| Tanita | 50 |
| Toggl | 24 |
| GCalendar | 18 |
| Zaim | 12 |
| **合計** | **154** |

詳細: [test/README.md](test/README.md)

## ドキュメント

| カテゴリ | リンク |
|----------|--------|
| **サービス共通** | [src/services/README.md](src/services/README.md) |
| **Fitbit** | [src/services/fitbit/README.md](src/services/fitbit/README.md) |
| **Google Calendar** | [src/services/gcalendar/README.md](src/services/gcalendar/README.md) |
| **Tanita** | [src/services/tanita/README.md](src/services/tanita/README.md) |
| **Toggl** | [src/services/toggl/README.md](src/services/toggl/README.md) |
| **Zaim** | [src/services/zaim/README.md](src/services/zaim/README.md) |
| **GitHub Actions** | [.github/workflows/README.md](.github/workflows/README.md) |
| **テスト** | [test/README.md](test/README.md) |

## 今後の拡張予定

### タスク・プロジェクト管理系

| サービス | 用途 | 認証方式 | 優先度 | ステータス |
|----------|------|----------|--------|------------|
| [Trello](https://developer.atlassian.com/cloud/trello/rest/) | ボード・カード管理 | OAuth 2.0 / API Key | 中 | 未着手 |
| [TickTick](https://developer.ticktick.com/) | タスク・習慣トラッカー | OAuth 2.0 | 高 | 未着手 |
| [Todoist](https://developer.todoist.com/rest/) | タスク管理 | OAuth 2.0 / Bearer | 中 | 未着手 |
| [Habitica](https://habitica.com/apidoc/) | 習慣・日課・To-Do（ゲーミフィケーション） | API Key + User ID | 高 | 未着手 |
| [Coda](https://coda.io/developers/apis/v1) | ドキュメント・テーブル | Bearer Token | 低 | 未着手 |

### 拡張の目的

- **計画 vs 実績分析**: Google Calendar（予定）+ Toggl（実績）に加え、タスク管理ツールのデータを統合することで、より精緻な時間管理分析が可能に
- **習慣トラッキング**: TickTick・Habiticaの習慣機能により、日次・週次の習慣達成率を可視化
- **プロジェクト進捗**: Trello/Todoistのタスク完了データから、プロジェクト単位の進捗を追跡

### 想定スキーマ

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ trello.*    │  │ ticktick.*  │  │ todoist.*   │  │ habitica.*  │  │ coda.*      │
│ (ボード)    │  │ (タスク)    │  │ (タスク)    │  │ (習慣)      │  │ (テーブル)  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │                │
       └────────────────┴────────────────┴────────────────┴────────────────┘
                                         │
                                         ▼
                                 ┌───────────────┐
                                 │  public.tasks │
                                 │  (統合ビュー) │
                                 └───────────────┘
```

### 実装時の注意点

- 既存の統一アーキテクチャ（types.ts, auth.ts, api.ts, fetch_data.ts, write_db.ts, sync_daily.ts）に従う
- 認証パターンはOAuth 2.0（パターンA）またはBearer Token（パターンC相当）
- タスクIDの永続化により、完了・未完了の状態変化を追跡可能にする

### データ収集の拡張方針

今後のサービス選定は、以下の3つの観点を重視する：

#### 1. 認知・精神状態の記録

| 対象データ | 候補サービス例 | 備考 |
|------------|----------------|------|
| 集中力・フロー状態 | Rize, RescueTime, Centered | 自動検出またはセルフレポート |
| 気分・感情ログ | Daylio, Pixels, How We Feel | 定期的なムードトラッキング |
| 瞑想・マインドフルネス | Headspace, Calm, Insight Timer | セッション時間・頻度・継続率 |

#### 2. 学習と知識管理

| 対象データ | 候補サービス例 | 備考 |
|------------|----------------|------|
| 読書・インプット量 | Goodreads, Booklog, Readwise | 読了冊数・ハイライト・メモ |
| アウトプット・創造性 | GitHub, Obsidian Publish, Medium | 執筆量・コミット数・公開頻度 |
| 復習の頻度 | Anki, RemNote, Readwise | 間隔反復学習の達成率 |

#### 3. 社会的・環境的要因

| 対象データ | 候補サービス例 | 備考 |
|------------|----------------|------|
| 社会交流の頻度 | Google Calendar, Strava | 予定の種類分類、グループ活動 |
| 作業環境の変化 | Swarm/Foursquare, Arc | 位置情報から作業場所を推定 |
| コミュニケーション量 | Slack, Discord | メッセージ数・反応数（プライバシー考慮） |

#### 選定基準

1. **API公開**: プログラマティックなデータ取得が可能であること
2. **データエクスポート**: API未公開でもエクスポート機能があれば検討
3. **継続性**: 60年以上の長期運用に耐えうるサービスか、代替手段があるか
4. **プライバシー**: 特に社会的データは、自分のデータのみを対象とする

## 技術スタック

- **ランタイム**: Deno
- **データベース**: Supabase (PostgreSQL)
- **CI/CD**: GitHub Actions
- **認証**: OAuth 2.0 (Fitbit, Tanita, Google), OAuth 1.0a (Zaim), Basic (Toggl)
