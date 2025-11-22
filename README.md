# supabase-sync-jobs

個人のライフログデータを各種サービスから取得し、Supabaseに統合・蓄積するための同期ジョブ群です。

## 目的

LIFETRACERプロジェクトの一環として、以下のデータソースを単一のSupabaseデータベースに集約し、長期的な自己理解・分析を可能にします。

- **時間の使い方** → Toggl Track
- **身体の状態** → Fitbit + Tanita Health Planet
- **お金の流れ** → Zaim

## サービス一覧

| サービス | データ種別 | 認証方式 | 自動実行 |
|----------|-----------|----------|----------|
| **Toggl** | タイムエントリ、クライアント、プロジェクト、タグ | API Token | 毎日 JST 00:00 |
| **Fitbit** | 睡眠、心拍数、活動量、体重、体脂肪、SpO2 | OAuth 2.0 | （手動） |
| **Tanita** | 体組成データ（体重、体脂肪率、筋肉量等） | OAuth 2.0 | 毎日 JST 09:00 |
| **Zaim** | 収支取引、カテゴリ、口座 | OAuth 1.0a | 毎日 JST 00:00 |

## ディレクトリ構成

```
supabase-sync-jobs/
├── .github/workflows/       # GitHub Actions 自動実行設定
│   ├── sync-toggl.yml
│   ├── sync-tanita.yml
│   ├── sync-zaim.yml
│   └── refresh-tanita-token.yml
│
├── src/services/
│   ├── fitbit/              # Fitbit同期モジュール
│   ├── tanita/              # Tanita Health Planet同期モジュール
│   ├── toggl/               # Toggl Track同期モジュール
│   ├── zaim/                # Zaim同期モジュール
│   └── supabase/            # Supabaseスキーマ定義SQL
│
├── supabase/
│   └── migrations/          # Supabase CLIマイグレーション
│
└── test/                    # テストコード
```

## ランタイム

このプロジェクトは [Deno](https://deno.land/) をランタイムとして使用します。

```bash
# Denoのインストール（macOS/Linux）
curl -fsSL https://deno.land/install.sh | sh

# Denoのインストール（Windows PowerShell）
irm https://deno.land/install.ps1 | iex
```

## 環境変数

### 共通（Supabase）

| 変数名 | 説明 |
|--------|------|
| `SUPABASE_URL` | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |

### Toggl

| 変数名 | 説明 |
|--------|------|
| `TOGGL_API_TOKEN` | Toggl API トークン |
| `TOGGL_WORKSPACE_ID` | Toggl ワークスペースID |
| `TOGGL_SYNC_DAYS` | 同期日数（オプション、デフォルト: 1） |

### Fitbit

| 変数名 | 説明 |
|--------|------|
| `FITBIT_CLIENT_ID` | Fitbit OAuth Client ID |
| `FITBIT_CLIENT_SECRET` | Fitbit OAuth Client Secret |

※ トークンはSupabase `fitbit_tokens` テーブルで管理

### Tanita

| 変数名 | 説明 |
|--------|------|
| `TANITA_CLIENT_ID` | Tanita OAuth Client ID |
| `TANITA_CLIENT_SECRET` | Tanita OAuth Client Secret |
| `HEIGHT_CM` | 身長（cm） |

※ トークンはSupabase `tanita_tokens` テーブルで管理

### Zaim

| 変数名 | 説明 |
|--------|------|
| `ZAIM_CONSUMER_KEY` | Zaim OAuth Consumer Key |
| `ZAIM_CONSUMER_SECRET` | Zaim OAuth Consumer Secret |
| `ZAIM_ACCESS_TOKEN` | Zaim OAuth Access Token |
| `ZAIM_ACCESS_TOKEN_SECRET` | Zaim OAuth Access Token Secret |
| `ZAIM_SYNC_DAYS` | 同期日数（オプション、デフォルト: 3） |

## GitHub Actions（自動実行）

| ワークフロー | スケジュール | 説明 |
|--------------|--------------|------|
| `sync-toggl.yml` | 毎日 JST 00:00 | Toggl タイムエントリ同期 |
| `sync-tanita.yml` | 毎日 JST 09:00 | Tanita 体組成データ同期 |
| `sync-zaim.yml` | 毎日 JST 00:00 | Zaim 収支データ同期 |
| `refresh-tanita-token.yml` | 毎週日曜 JST 03:00 | Tanita トークンリフレッシュ |

### GitHub Secrets の設定

1. リポジトリの **Settings** > **Secrets and variables** > **Actions** に移動
2. 上記の環境変数をすべて登録

## 手動実行

### Toggl

```bash
# 日次同期（直近1日）
deno run --allow-net --allow-env --allow-read src/services/toggl/sync_daily.ts

# 同期日数を指定
TOGGL_SYNC_DAYS=7 deno run --allow-net --allow-env --allow-read src/services/toggl/sync_daily.ts
```

### Tanita

```bash
# 日次同期
deno run --allow-net --allow-env --allow-read src/services/tanita/tanita_daily_sync.ts

# トークンリフレッシュ
deno run --allow-net --allow-env --allow-read src/services/tanita/tanita_refresh_and_save.ts
```

### Fitbit

```bash
# データ取得（キャッシュ保存）
deno run --allow-all src/services/fitbit/fetch_fitbit_data.ts 2025-01-01 2025-01-31

# Supabaseへ同期
deno run --allow-all src/services/fitbit/sync_fitbit_to_supabase.ts 2025-01-01 2025-01-31
```

### Zaim

```bash
# 日次同期（直近3日）
deno run --allow-net --allow-env --allow-read src/services/zaim/sync_daily.ts

# 全件同期（年単位）
deno run --allow-net --allow-env --allow-read src/services/zaim/sync_all_transactions.ts --start=2024
```

## Supabaseスキーマ

### public スキーマ

- `toggl_clients` / `toggl_projects` / `toggl_tags` / `toggl_time_entries`
- `health_data_*`（各種健康データ）
- `fitbit_tokens` / `tanita_tokens`（OAuthトークン管理）

### zaim スキーマ

- `zaim.categories` / `zaim.genres` / `zaim.accounts` / `zaim.transactions`
- `zaim.sync_log`（同期ログ）

詳細は [`src/services/supabase/README.md`](src/services/supabase/README.md) を参照。

## 各サービスの詳細ドキュメント

| サービス | ドキュメント |
|----------|--------------|
| Fitbit | [`src/services/fitbit/README.md`](src/services/fitbit/README.md) |
| Zaim | [`src/services/zaim/README.md`](src/services/zaim/README.md) |
| Supabase | [`src/services/supabase/README.md`](src/services/supabase/README.md) |
| Toggl | （未作成） |
| Tanita | （未作成） |

## ライセンス

Private（個人利用）
