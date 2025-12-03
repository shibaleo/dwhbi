---
title: バックログ
description: 将来の拡張予定
---

# バックログ

## 対象ドメイン

| ドメイン | 対応済みサービス | 将来追加候補 |
|---------|-----------------|-------------|
| 時間管理 | Toggl Track | Clockify |
| 予定管理 | Google Calendar | Outlook Calendar |
| 家計管理 | Zaim | PocketSmith |
| 健康管理 | Fitbit, Tanita Health Planet | Strava, Garmin |
| プロジェクト管理 | Trello | Asana, ClickUp |
| タスク管理 | TickTick | Todoist, Google Tasks |
| 習慣管理 | TickTick | Habitify, Habitica |
| マスタ管理 | Airtable | - |
| 休息管理 | - | YouTube |
| 知識管理 | - | Notion, Obsidian |

## データソース追加

| サービス | ドメイン | 優先度 | 備考 |
|---------|---------|:------:|------|
| Todoist | タスク管理 | 中 | |
| Habitify | 習慣管理 | 中 | |
| YouTube | 休息管理 | 中 | 視聴履歴 |
| Notion | 知識管理 | 中 | |
| Obsidian | 知識管理 | 低 | GitHub経由 |
| Strava | 健康管理 | 低 | |
| Garmin | 健康管理 | 低 | |

## 機能追加

| 機能 | 優先度 | 備考 |
|------|:------:|------|
| staging層ビュー | 高 | Phase 2（Toggl完了） |
| Google Calendar staging層 | 高 | Togglとのクロスドメイン分析用 |
| refスキーマ設計 | 高 | マスタテーブル（プロジェクト分類等） |
| マスタテーブル編集UI | 高 | 管理画面からの編集機能 |
| core層ビュー | 高 | ref + staging結合 |
| marts層ビュー | 高 | 分析用ビュー |
| BIダッシュボード | 中 | Phase 3 |
| アラート通知 | 中 | Slack/Discord |
| Fitbit追加データ | 低 | Breathing Rate等 |
| Tanita Health Planet 歩数 | 低 | pedometer |
| HL7 FHIR標準化 | 低 | 健康データの相互運用性 |

## Inbox（未整理）

- **Asana**: プロジェクト管理の代替として検証予定
- **Notion**: どのデータベース・ページを管理するか選択UIが必要
- **Obsidian**: vault自体をGitHubにアップロードし、GitHub PAT経由で取得
- **Coda**: 新規追加予定、用途未検討
- **YouTube**: 休息管理として視聴履歴を取得予定
