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

| 機能 | 優先度 | ステータス | 備考 |
|------|:------:|:----------:|------|
| Toggl staging層 | 高 | ✅ | 9モデル + 47テスト |
| Google Calendar staging層 | 高 | ✅ | 4モデル + 29テスト + seed |
| GitHub PAT管理 | 高 | ✅ | Supabase Vault |
| 同期実行ボタン | 高 | ✅ | workflow_dispatch API |
| Actions使用量表示 | 中 | ✅ | 今月の使用時間 |
| Composite Action共通化 | 中 | ✅ | python-setup |
| Reports API効率化 | 中 | ✅ | page_size=1000 |
| dbt generate_schema_name マクロ | 中 | ✅ | カスタムスキーマ対応 |
| Fitbit staging層 | 高 | ⏳ | 健康データ分析用 |
| Zaim staging層 | 中 | ⏳ | 支出分析用 |
| Tanita staging層 | 中 | ⏳ | 体組成データ分析用 |
| Trello staging層 | 中 | ⏳ | プロジェクト管理分析用 |
| TickTick staging層 | 中 | ⏳ | タスク管理分析用 |
| Airtable staging層 | 低 | ⏳ | マスタ管理用 |
| seedsスキーマ拡張 | 中 | ⏳ | マスタテーブル（プロジェクト分類等） |
| マスタテーブル編集UI | 中 | ⏳ | 管理画面からの編集機能 |
| core層ビュー | 中 | ⏳ | seeds + staging結合（2サービス以上必要） |
| marts層ビュー | 中 | ⏳ | 分析用ビュー |
| CLI化（typer） | 低 | ⏳ | workflow呼び出し簡素化、ローカルテスト容易化 |
| Python内並列化 | 低 | ⏳ | asyncio.gatherで同期処理を並列実行 |
| BIダッシュボード | 低 | ⏳ | Phase 3 |
| アラート通知 | 低 | ⏳ | Slack/Discord |
| Fitbit追加データ | 低 | ⏳ | Breathing Rate等 |
| Tanita Health Planet 歩数 | 低 | ⏳ | pedometer |
| HL7 FHIR標準化 | 低 | ⏳ | 健康データの相互運用性 |

## Inbox（未整理）

- **Asana**: プロジェクト管理の代替として検証予定
- **Notion**: どのデータベース・ページを管理するか選択UIが必要
- **Obsidian**: vault自体をGitHubにアップロードし、GitHub PAT経由で取得
- **Coda**: 新規追加予定、用途未検討
- **YouTube**: 休息管理として視聴履歴を取得予定

## Phase 5 参考資料（ビジュアルETL）

### スキーマ可視化
- **Liam ERD**: Prisma/Rails/SQL対応のER図ツール。tbls JSONからインポート可能

### ノードエディタOSS
| ライブラリ | 特徴 | Blender風 |
|-----------|------|:---------:|
| **Rete.js** | 最もBlender風、プラグイン豊富、TypeScript対応 | ⭐⭐⭐ |
| **ReactFlow** | React向け、シンプル、ドキュメント充実 | ⭐⭐ |
| **Litegraph.js** | Comfy UI採用、グラフ実行エンジン内蔵 | ⭐⭐⭐ |
| **Baklava.js** | Vue向け、計算グラフ対応 | ⭐⭐ |
| **Flume** | React向け、ロジックビルダー特化 | ⭐ |
| **Node-RED** | フルスタック、IoT/ETL実績多数 | ⭐⭐ |
