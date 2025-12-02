# 運用手順書（Runbook）

## 手動実行

```bash
# 仮想環境アクティベート
source .venv/Scripts/activate  # Git Bash
.venv\Scripts\activate          # Windows CMD

# 各サービス個別実行
python -m pipelines.services.toggl
python -m pipelines.services.gcalendar
python -m pipelines.services.zaim
python -m pipelines.services.fitbit
python -m pipelines.services.tanita
python -m pipelines.services.trello
python -m pipelines.services.ticktick
python -m pipelines.services.airtable
```

## GitHub Actions（自動同期）

```yaml
# .github/workflows/sync-daily.yml
name: Daily Sync
on:
  schedule:
    - cron: '0 21 * * *'  # UTC 21:00 = JST 06:00
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt
      - name: Sync All Services
        run: |
          python -m pipelines.services.toggl
          python -m pipelines.services.gcalendar
          python -m pipelines.services.zaim
          python -m pipelines.services.fitbit
          python -m pipelines.services.tanita
          python -m pipelines.services.trello
          python -m pipelines.services.ticktick
          python -m pipelines.services.airtable
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY }}
```

## テスト実行

```bash
# 全テスト
pytest tests/pipelines/ -v

# サービス別
pytest tests/pipelines/test_toggl.py -v      # 12テスト
pytest tests/pipelines/test_gcalendar.py -v  # 20テスト
pytest tests/pipelines/test_zaim.py -v       # 26テスト
pytest tests/pipelines/test_fitbit.py -v     # 23テスト
pytest tests/pipelines/test_tanita.py -v     # 24テスト
pytest tests/pipelines/test_trello.py -v     # 26テスト

# カバレッジ
pytest tests/pipelines/ --cov=pipelines
```

## モニタリング

| 項目 | 説明 | アラート条件 |
|------|------|------------|
| 同期成功率 | 各サービスの成功/失敗 | 3日連続失敗 |
| データ件数 | 各テーブルのレコード数 | 0件 |
| 処理時間 | 同期の所要時間 | 10分超 |
| レート制限 | Fitbit: 150 req/h | 90%超 |

## トラブルシューティング

### 認証エラー

```
Error: Invalid credentials for service 'fitbit'
```

**原因**: access_tokenの期限切れ、refresh失敗

**対処**:
1. Supabaseで `credentials.services` を確認
2. `expires_at` が過去の場合、手動でOAuth再認証
3. refresh_tokenも無効な場合は完全再認証

### レート制限

```
Error: 429 Too Many Requests
```

**原因**: APIのレート制限に到達

**対処**:
1. Fitbit: 150 req/h なので、1時間待つ
2. 取得日数を減らして再実行
3. チャンクサイズを調整

### DB接続エラー

```
Error: Connection refused to Supabase
```

**対処**:
1. `SUPABASE_URL` の確認
2. `SUPABASE_SERVICE_ROLE_KEY` の確認
3. Supabaseダッシュボードでプロジェクト状態確認

## バックアップ

### 手動バックアップ

```bash
# Supabase CLIでエクスポート
supabase db dump -f backup.sql
```

### 自動バックアップ（将来）

- Supabase Pro プランで自動バックアップ有効化
- Point-in-time recovery (PITR) の設定
