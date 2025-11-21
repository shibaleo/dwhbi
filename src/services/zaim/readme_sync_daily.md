# Zaim日次同期 セットアップガイド

## 概要

毎日自動的にZaimのデータ（マスタ + トランザクション）をSupabaseに同期します。

- **実行時刻**: 毎日 JST 00:00（UTC 15:00）
- **同期内容**: 
  - マスタデータ: カテゴリ、ジャンル、口座
  - トランザクション: 直近3日間（カスタマイズ可能）

---

## セットアップ手順

### 1. ファイル配置

プロジェクトに以下のファイルを配置：

```
supabase-sync-jobs/
├── .github/
│   └── workflows/
│       └── zaim_daily_sync.yml       # 新規追加
└── src/services/zaim/
    ├── api.ts                        # 既存
    ├── sync_masters.ts               # 既存
    ├── sync_transactions.ts          # 既存
    └── sync_daily.ts                 # 新規追加
```

### 2. GitHub Secrets の設定

リポジトリの Settings > Secrets and variables > Actions > New repository secret から以下を追加：

#### Supabase

| Secret名 | 説明 | 取得方法 |
|---------|------|---------|
| `SUPABASE_URL` | プロジェクトURL | Supabase Dashboard > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | サービスロールキー | Supabase Dashboard > Settings > API |

#### Zaim OAuth

| Secret名 | 説明 | 取得方法 |
|---------|------|---------|
| `ZAIM_CONSUMER_KEY` | Consumer Key | Zaim Developer > アプリ詳細 |
| `ZAIM_CONSUMER_SECRET` | Consumer Secret | Zaim Developer > アプリ詳細 |
| `ZAIM_ACCESS_TOKEN` | Access Token | OAuth認証後に取得 |
| `ZAIM_ACCESS_TOKEN_SECRET` | Access Token Secret | OAuth認証後に取得 |

> **注意**: サービスロールキーは管理者権限を持つため、絶対に公開しないでください。

---

## 動作確認

### ローカルでテスト実行

```bash
# .envファイルに環境変数を設定
cat > .env <<EOF
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ZAIM_CONSUMER_KEY=your_consumer_key
ZAIM_CONSUMER_SECRET=your_consumer_secret
ZAIM_ACCESS_TOKEN=your_access_token
ZAIM_ACCESS_TOKEN_SECRET=your_access_token_secret
ZAIM_SYNC_DAYS=3
EOF

# 実行
deno run --allow-net --allow-env --allow-read src/services/zaim/sync_daily.ts
```

期待される出力：

```
🚀 Zaim日次同期開始
============================================================
対象期間: 直近3日間
開始時刻: 2025/11/21 9:00:00
============================================================

📚 マスタデータ同期開始
────────────────────────────────────────────────────────────
✅ マスタデータ同期完了
   カテゴリ: 50件
   ジャンル: 150件
   口座: 10件

💰 トランザクションデータ同期開始（直近3日間）
────────────────────────────────────────────────────────────
✅ トランザクションデータ同期完了
   取得: 45件
   挿入: 5件
   更新: 40件

⏱️  実行時間: 2.34秒

============================================================
📊 日次同期結果サマリー
============================================================
実行時刻: 2025/11/21 9:00:00
ステータス: ✅ 成功

マスタデータ:
  カテゴリ: 50件
  ジャンル: 150件
  口座: 10件

トランザクションデータ:
  取得: 45件
  挿入: 5件
  更新: 40件
============================================================

✅ 日次同期が正常に完了しました
```

---

## GitHub Actionsでの実行

### 自動実行

コミット・プッシュ後、毎日 JST 09:00 に自動実行されます。

```bash
git add .github/workflows/zaim_daily_sync.yml src/services/zaim/sync_daily.ts
git commit -m "Add Zaim daily sync workflow"
git push
```

### 手動実行

GitHub リポジトリページから：

1. **Actions** タブを開く
2. 左サイドバーから **Zaim Daily Sync** を選択
3. **Run workflow** ボタンをクリック
4. オプション: 同期日数を変更（デフォルト3日）
5. **Run workflow** を実行

### 実行履歴の確認

1. **Actions** タブを開く
2. ワークフロー実行の一覧から確認したい実行をクリック
3. **sync-zaim** ジョブをクリック
4. 各ステップのログを確認

---

## カスタマイズ

### 同期日数の変更

#### 方法1: ワークフローファイルを編集

`.github/workflows/zaim_daily_sync.yml`:

```yaml
env:
  ZAIM_SYNC_DAYS: '7'  # 7日間に変更
```

#### 方法2: 手動実行時に指定

GitHub Actions の手動実行画面で `sync_days` に任意の日数を入力。

### 実行時刻の変更

`.github/workflows/zaim_daily_sync.yml`:

```yaml
schedule:
  # JST 21:00（UTC 12:00）に変更
  - cron: '0 12 * * *'
```

cron式の参考：
- `0 0 * * *` - 毎日 JST 09:00
- `0 12 * * *` - 毎日 JST 21:00
- `0 */6 * * *` - 6時間ごと
- `0 0 * * 1` - 毎週月曜 JST 09:00

### 通知の追加

失敗時にSlackへ通知する例：

```yaml
- name: Notify on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "❌ Zaim日次同期が失敗しました",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Zaim日次同期エラー*\n詳細: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## トラブルシューティング

### エラー: `SUPABASE_URL is not defined`

**原因**: GitHub Secrets が設定されていない

**解決方法**: 
1. リポジトリの Settings > Secrets and variables > Actions を開く
2. 必要な Secrets を追加

### エラー: `OAuth authentication failed`

**原因**: Zaim OAuth トークンの有効期限切れ

**解決方法**:
1. Zaim Developer コンソールで新しいトークンを取得
2. GitHub Secrets を更新

### ワークフローが実行されない

**原因**: デフォルトブランチ以外にプッシュした

**解決方法**: 
- ワークフローファイルは `main` または `master` ブランチに配置する必要があります
- または、ワークフローファイルに `branches: [your-branch]` を追加

### タイムアウトエラー

**原因**: API呼び出しやネットワークの遅延

**解決方法**: 
- 同期日数を減らす（3日 → 1日）
- ワークフローにタイムアウト設定を追加：

```yaml
jobs:
  sync-zaim:
    runs-on: ubuntu-latest
    timeout-minutes: 10  # タイムアウトを10分に設定
```

---

## モニタリング

### 同期ログの確認

Supabaseで同期履歴を確認：

```sql
-- 直近10件の同期ログ
SELECT 
  sync_started_at,
  sync_status,
  records_fetched,
  records_inserted,
  records_updated,
  error_message
FROM zaim_sync_log
ORDER BY sync_started_at DESC
LIMIT 10;

-- エラーが発生した同期
SELECT 
  sync_started_at,
  api_endpoint,
  error_message
FROM zaim_sync_log
WHERE sync_status = 'failed'
ORDER BY sync_started_at DESC;
```

### データの整合性確認

```sql
-- 最新データの確認
SELECT 
  MAX(synced_at) as last_sync,
  COUNT(*) as total_records
FROM zaim_transactions;

-- 日別トランザクション数
SELECT 
  date,
  COUNT(*) as count
FROM zaim_transactions
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;
```

---

## 次のステップ

- [ ] GitHub Secrets の設定
- [ ] ローカルでテスト実行
- [ ] GitHub Actions ワークフローの追加
- [ ] 手動実行で動作確認
- [ ] 自動実行の監視

---

## 参考

- [GitHub Actions - Scheduled events](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
- [Cron式の書き方](https://crontab.guru/)
- [Deno Deploy - Environment variables](https://deno.com/deploy/docs/environment-variables)