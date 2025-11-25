# GitHub Actions Setup

このディレクトリには、各種サービスのデータをSupabaseに同期するためのGitHub Actionsワークフローが含まれています。

## ワークフロー一覧

| ワークフロー | スケジュール | 説明 |
|--------------|--------------|------|
| `sync-daily.yml` | 毎日 JST 00:00 | 全サービス並列同期（推奨） |
| `sync-fitbit.yml` | 手動のみ | Fitbit 健康データ同期 |
| `sync-gcalendar.yml` | 手動のみ | Google Calendar イベント同期 |
| `sync-tanita.yml` | 手動のみ | Tanita 体組成データ同期 |
| `sync-toggl.yml` | 手動のみ | Toggl タイムエントリ同期 |
| `sync-zaim.yml` | 手動のみ | Zaim 収支データ同期 |

> **Note**: 定期実行は `sync-daily.yml` に統合されています。個別ワークフローは手動実行用です。

---

## セットアップ手順

GitHubリポジトリで以下のSecretsを設定する必要があります：

1. GitHubリポジトリの **Settings** > **Secrets and variables** > **Actions** に移動
2. 以下のSecretsを追加（**New repository secret** をクリック）

### 必須Secrets（3つのみ）

| Secret名 | 説明 |
|----------|------|
| `SUPABASE_URL` | Supabaseプロジェクトの URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseサービスロールキー |
| `TOKEN_ENCRYPTION_KEY` | トークン暗号化キー（32バイト以上） |

> **Note**: 各サービスの認証情報（APIトークン、OAuth credentials等）は
> `credentials.services` テーブルに暗号化して保存されています。
> 環境変数での設定は不要です。

---

## 手動実行

各ワークフローは手動でも実行できます：

1. GitHubリポジトリの **Actions** タブに移動
2. 左サイドバーから実行したいワークフローを選択
3. **Run workflow** ボタンをクリック

### パラメータ付き手動実行

#### All Services Daily Sync（推奨）
- `toggl_sync_days`: Toggl同期日数（デフォルト: 3）
- `tanita_sync_days`: Tanita同期日数（デフォルト: 3）
- `zaim_sync_days`: Zaim同期日数（デフォルト: 3）
- `gcal_sync_days`: Google Calendar同期日数（デフォルト: 3）
- `fitbit_sync_days`: Fitbit同期日数（デフォルト: 3）

> **Note**: `sync-daily.yml` は単一ジョブで全サービスを**並列実行**します。
> TypeScriptレベルで `Promise.allSettled` を使用し、
> 1つのサービスが失敗しても他は継続します。

#### 個別サービス同期
各サービスのワークフローは `sync_days` パラメータで同期日数を指定できます（デフォルト: 3）。

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
| sync-daily | `0 15 * * *` | 15:00 | 00:00 |

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
- OAuth 2.0トークン（Fitbit, Tanita）は同期時に自動でリフレッシュされます
