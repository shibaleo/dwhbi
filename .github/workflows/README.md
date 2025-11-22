# GitHub Actions Setup

このディレクトリには、各種サービスのデータをSupabaseに同期するためのGitHub Actionsワークフローが含まれています。

## ワークフロー一覧

| ワークフロー | スケジュール | 説明 |
|--------------|--------------|------|
| `sync-toggl.yml` | 毎日 JST 00:00 | Toggl タイムエントリ同期 |
| `sync-tanita.yml` | 毎日 JST 09:00 | Tanita 体組成データ同期 |
| `sync-zaim.yml` | 毎日 JST 00:00 | Zaim 収支データ同期 |
| `refresh-tanita-token.yml` | 毎週日曜 JST 03:00 | Tanita トークンリフレッシュ |

---

## セットアップ手順

GitHubリポジトリで以下のSecretsを設定する必要があります：

1. GitHubリポジトリの **Settings** > **Secrets and variables** > **Actions** に移動
2. 以下のSecretsを追加（**New repository secret** をクリック）

### 共通（必須）

| Secret名 | 説明 |
|----------|------|
| `SUPABASE_URL` | Supabaseプロジェクトの URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseサービスロールキー |

### Toggl

| Secret名 | 説明 |
|----------|------|
| `TOGGL_API_TOKEN` | Toggl APIトークン |
| `TOGGL_WORKSPACE_ID` | TogglワークスペースID |

### Tanita

| Secret名 | 説明 |
|----------|------|
| `TANITA_CLIENT_ID` | Tanita OAuth Client ID |
| `TANITA_CLIENT_SECRET` | Tanita OAuth Client Secret |
| `HEIGHT_CM` | 身長（cm） |

### Zaim

| Secret名 | 説明 |
|----------|------|
| `ZAIM_CONSUMER_KEY` | Zaim OAuth Consumer Key |
| `ZAIM_CONSUMER_SECRET` | Zaim OAuth Consumer Secret |
| `ZAIM_ACCESS_TOKEN` | Zaim OAuth Access Token |
| `ZAIM_ACCESS_TOKEN_SECRET` | Zaim OAuth Access Token Secret |

---

## 手動実行

各ワークフローは手動でも実行できます：

1. GitHubリポジトリの **Actions** タブに移動
2. 左サイドバーから実行したいワークフローを選択
3. **Run workflow** ボタンをクリック

### パラメータ付き手動実行

#### Toggl Daily Sync
- `sync_days`: 同期する日数（デフォルト: 1）

#### Zaim Daily Sync
- `sync_days`: 同期する日数（デフォルト: 3）

---

## cronスケジュール

### cronの形式
```
┌───────────── 分 (0 - 59)
│ ┌───────────── 時 (0 - 23)
│ │ ┌───────────── 日 (1 - 31)
│ │ │ ┌───────────── 月 (1 - 12)
│ │ │ │ ┌───────────── 曜日 (0 - 6) (日曜日から土曜日)
│ │ │ │ │
* * * * *
```

### 現在の設定

| ワークフロー | cron | UTC | JST |
|--------------|------|-----|-----|
| sync-toggl | `0 15 * * *` | 15:00 | 00:00 |
| sync-tanita | `0 0 * * *` | 00:00 | 09:00 |
| sync-zaim | `0 15 * * *` | 15:00 | 00:00 |
| refresh-tanita-token | `0 18 * * 0` | 日曜 18:00 | 月曜 03:00 |

### その他のスケジュール例
- `0 * * * *` - 毎時0分（1時間ごと）
- `*/30 * * * *` - 30分ごと
- `0 */2 * * *` - 2時間ごと
- `0 9 * * *` - 毎日9:00 UTC
- `0 0 * * 0` - 毎週日曜日の0:00 UTC

---

## 注意事項

- GitHub Actionsの無料枠では、月2000分まで利用可能
- cronジョブはUTC時間で実行されます
- 実行タイミングは数分ずれる可能性があります
- 失敗時はActionsタブでログを確認してください
