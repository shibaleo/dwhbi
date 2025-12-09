---
title: "Phase 7: cron 設定 (日次レポート生成)"
description: 日次レポート生成のための同期・変換・レポート出力の自動実行
---

# Phase 7: cron 設定 (日次レポート生成)

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | 日次レポート生成パイプラインの自動実行 |
| 前提条件 | Phase 6 完了（全サービス稼働） |
| 成果物 | 毎日自動で同期・変換・レポート生成が実行される |
| 想定作業 | VM での cron 設定、ログ設定 |

---

## 日次レポート生成パイプライン

```
01:00 JST                02:00 JST                03:00 JST
    │                        │                        │
    ▼                        ▼                        ▼
┌─────────┐            ┌─────────┐            ┌─────────┐
│ 同期    │            │ 変換    │            │ レポート │
│         │            │         │            │         │
│ Toggl   │───────────►│ dbt     │───────────►│ Typst   │
│ GCal    │            │ run     │            │ PDF生成 │
└─────────┘            └─────────┘            └─────────┘
     │                      │                      │
     ▼                      ▼                      ▼
┌─────────┐            ┌─────────┐            ┌─────────┐
│raw_*    │            │mst_*    │            │daily.pdf│
│テーブル  │            │fact_*   │            │         │
└─────────┘            └─────────┘            └─────────┘
```

**目的:** 前日のデータを収集・変換し、日次レポートを自動生成する

---

## Step 7.1: crontab ファイル作成

**目的:** cron 設定をファイルとして管理

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 7.1.1 | crontab ファイル作成 | `infra/crontab` | ⬜ |
| 7.1.2 | タイムゾーン確認 | VM が JST か UTC か | ⬜ |

### infra/crontab

```bash
# /opt/supabase-sync-jobs/infra/crontab
# 日次レポート生成パイプライン
#
# VM タイムゾーン: UTC
# JST = UTC + 9
#
# 実行順序:
# 1. データ同期 (01:00 JST = 16:00 UTC)
# 2. dbt 変換  (02:00 JST = 17:00 UTC)
# 3. レポート生成 (03:00 JST = 18:00 UTC)
#
# 注意: cron では環境変数が展開されないため、絶対パスを使用

SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# ====================
# 1. データ同期
# ====================

# Toggl Track 同期 (01:00 JST = 16:00 UTC)
0 16 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm connector npm run sync:toggl >> /var/log/supabase-sync-jobs/sync.log 2>&1

# Google Calendar 同期 (01:05 JST = 16:05 UTC)
5 16 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm connector npm run sync:gcal >> /var/log/supabase-sync-jobs/sync.log 2>&1

# ====================
# 2. dbt 変換
# ====================

# dbt run (02:00 JST = 17:00 UTC)
0 17 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm transform dbt run >> /var/log/supabase-sync-jobs/dbt.log 2>&1

# ====================
# 3. レポート生成
# ====================

# 日次レポート生成 (03:00 JST = 18:00 UTC)
0 18 * * * cd /opt/supabase-sync-jobs/infra && docker compose run --rm reporter npm run generate >> /var/log/supabase-sync-jobs/reporter.log 2>&1

# ====================
# メンテナンス
# ====================

# ログローテーション (毎週日曜 04:00 JST = 19:00 UTC)
0 19 * * 0 find /var/log/supabase-sync-jobs -name "*.log" -mtime +30 -delete
```

### タイムゾーン対応表

| JST | UTC | 処理 |
|-----|-----|------|
| 01:00 | 16:00 | Toggl 同期 |
| 01:05 | 16:05 | GCal 同期 |
| 02:00 | 17:00 | dbt 変換 |
| 03:00 | 18:00 | レポート生成 |

---

## Step 7.2: ログディレクトリ設定

**目的:** cron ジョブのログを保存するディレクトリを準備

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 7.2.1 | ディレクトリ確認 | `ls -la /var/log/supabase-sync-jobs` | ⬜ |
| 7.2.2 | 存在しない場合作成 | `sudo mkdir -p /var/log/supabase-sync-jobs` | ⬜ |
| 7.2.3 | 所有者設定 | `sudo chown -R ubuntu:ubuntu /var/log/supabase-sync-jobs` | ⬜ |

### ログファイル構成

```
/var/log/supabase-sync-jobs/
├── sync.log       # Toggl/GCal 同期ログ
├── dbt.log        # dbt 変換ログ
└── reporter.log   # レポート生成ログ
```

---

## Step 7.3: crontab インストール

**目的:** VM に crontab を設定

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 7.3.1 | SSH 接続 | `ssh lifetracer` | ⬜ |
| 7.3.2 | 現在の crontab 確認 | `crontab -l` | ⬜ |
| 7.3.3 | crontab インストール | `crontab /opt/supabase-sync-jobs/infra/crontab` | ⬜ |
| 7.3.4 | 設定確認 | `crontab -l` | ⬜ |

### インストールコマンド

```bash
# SSH 接続
ssh lifetracer

# 現在の crontab 確認（なければ空）
crontab -l

# crontab インストール
crontab /opt/supabase-sync-jobs/infra/crontab

# 確認
crontab -l
```

---

## Step 7.4: テスト実行

**目的:** 各ジョブが正常に動作することを確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 7.4.1 | 同期テスト | 手動実行 | ⬜ |
| 7.4.2 | dbt テスト | 手動実行 | ⬜ |
| 7.4.3 | レポートテスト | 手動実行 | ⬜ |
| 7.4.4 | ログ確認 | 各ログファイル | ⬜ |

### 手動実行コマンド

```bash
cd /opt/supabase-sync-jobs/infra

# Toggl 同期
docker compose run --rm connector npm run sync:toggl

# GCal 同期
docker compose run --rm connector npm run sync:gcal

# dbt 変換
docker compose run --rm transform dbt run

# レポート生成
docker compose run --rm reporter npm run generate
```

### ログ確認

```bash
# 同期ログ
tail -f /var/log/supabase-sync-jobs/sync.log

# dbt ログ
tail -f /var/log/supabase-sync-jobs/dbt.log

# レポートログ
tail -f /var/log/supabase-sync-jobs/reporter.log
```

---

## Step 7.5: cron サービス確認

**目的:** cron デーモンが稼働していることを確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 7.5.1 | cron サービス状態 | `systemctl status cron` | ⬜ |
| 7.5.2 | 自動起動確認 | `systemctl is-enabled cron` | ⬜ |

### 確認コマンド

```bash
# cron サービス状態
sudo systemctl status cron

# 出力例
● cron.service - Regular background program processing daemon
     Loaded: loaded (/lib/systemd/system/cron.service; enabled; vendor preset: enabled)
     Active: active (running)
```

---

## Step 7.6: 実行監視設定

**目的:** ジョブ実行の成否を監視

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 7.6.1 | 実行結果チェックスクリプト | 作成（オプション） | ⬜ |
| 7.6.2 | メール通知設定 | 失敗時通知（オプション） | ⬜ |

### 実行結果チェックスクリプト（オプション）

```bash
#!/bin/bash
# /opt/supabase-sync-jobs/infra/scripts/check-jobs.sh

TODAY=$(date +%Y-%m-%d)

echo "=== Job Status Check ($TODAY) ==="

# 今日のログエントリを確認
for log in sync dbt reporter; do
  if grep -q "$TODAY" "/var/log/supabase-sync-jobs/${log}.log" 2>/dev/null; then
    if grep -q "error\|Error\|ERROR" "/var/log/supabase-sync-jobs/${log}.log" | grep "$TODAY"; then
      echo "[$log] ❌ Error detected"
    else
      echo "[$log] ✓ Completed"
    fi
  else
    echo "[$log] ⚠ No entries today"
  fi
done
```

---

## Step 7.7: ログローテーション設定

**目的:** ログファイルの肥大化を防ぐ

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 7.7.1 | logrotate 設定 | `/etc/logrotate.d/supabase-sync-jobs` | ⬜ |

### logrotate 設定

```bash
# /etc/logrotate.d/supabase-sync-jobs
/var/log/supabase-sync-jobs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 ubuntu ubuntu
}
```

### インストール

```bash
sudo tee /etc/logrotate.d/supabase-sync-jobs << 'EOF'
/var/log/supabase-sync-jobs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 ubuntu ubuntu
}
EOF

# テスト
sudo logrotate -d /etc/logrotate.d/supabase-sync-jobs
```

---

## Step 7.8: 翌日確認

**目的:** 実際に cron が動作したことを確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 7.8.1 | 翌日にログ確認 | sync.log にエントリがあるか | ⬜ |
| 7.8.2 | dbt.log 確認 | 変換が成功したか | ⬜ |
| 7.8.3 | reporter.log 確認 | レポートが生成されたか | ⬜ |
| 7.8.4 | 出力確認 | レポートファイルの存在確認 | ⬜ |

### 確認コマンド

```bash
# 同期ログ（最新10行）
tail -10 /var/log/supabase-sync-jobs/sync.log

# dbt ログ（最新10行）
tail -10 /var/log/supabase-sync-jobs/dbt.log

# レポートログ（最新10行）
tail -10 /var/log/supabase-sync-jobs/reporter.log

# 生成されたレポート確認
docker compose run --rm reporter ls -la output/
```

---

## 完了チェックリスト

- [ ] `infra/crontab` ファイルが作成された
- [ ] タイムゾーンが考慮されている（UTC vs JST）
- [ ] `/var/log/supabase-sync-jobs/` ディレクトリが存在する
- [ ] `crontab -l` で設定が表示される
- [ ] 手動実行で各ジョブが成功する
- [ ] cron サービスが稼働中
- [ ] logrotate 設定が完了
- [ ] 翌日、自動実行のログが確認できた

---

## トラブルシューティング

### cron ジョブが実行されない

```bash
# cron サービス確認
sudo systemctl status cron

# syslog で cron 実行履歴確認
grep CRON /var/log/syslog | tail -20

# 環境変数確認（PATH が設定されているか）
crontab -l | grep PATH
```

### Docker コマンドが失敗する

```bash
# docker グループ確認
groups

# cron から実行する場合、フルパスが必要な場合あり
which docker
# /usr/bin/docker

# crontab で明示的にパス指定
PATH=/usr/local/bin:/usr/bin:/bin
```

### ログに何も出力されない

```bash
# ログディレクトリのパーミッション確認
ls -la /var/log/supabase-sync-jobs/

# 手動でリダイレクトテスト
echo "test" >> /var/log/supabase-sync-jobs/test.log
cat /var/log/supabase-sync-jobs/test.log
rm /var/log/supabase-sync-jobs/test.log
```

---

## 補足: cron 式リファレンス

```
┌───────────── 分 (0-59)
│ ┌───────────── 時 (0-23)
│ │ ┌───────────── 日 (1-31)
│ │ │ ┌───────────── 月 (1-12)
│ │ │ │ ┌───────────── 曜日 (0-7, 0 と 7 は日曜)
│ │ │ │ │
* * * * * command
```

| 式 | 説明 |
|-----|------|
| `0 16 * * *` | 毎日 16:00 UTC (01:00 JST) |
| `0 17 * * *` | 毎日 17:00 UTC (02:00 JST) |
| `0 18 * * *` | 毎日 18:00 UTC (03:00 JST) |
| `0 19 * * 0` | 毎週日曜 19:00 UTC |

---

## 次のステップ

→ [Phase 8: GitHub Actions 整理](./infra-phase-8-github-actions)
