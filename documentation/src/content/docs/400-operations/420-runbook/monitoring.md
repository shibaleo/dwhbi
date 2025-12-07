---
title: 監視設計
description: システム監視とアラートの設計
---

# 監視設計

## 方針

同期ジョブの成功/失敗を sync_logs テーブルで記録し、失敗時は console ダッシュボードで可視化する。将来的には GitHub Actions の失敗時に Slack/Discord 通知を追加する。監視対象は「同期成功率」「API レート制限残量」「Actions 使用時間」「DB 容量」。Supabase のダッシュボードと GitHub Actions の実行履歴を日次で確認する運用とする。
