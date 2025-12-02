# LIFETRACER 設計ドキュメント

> Personal Data Warehouse Platform - 60年運用を目指す個人データ基盤

## クイックリンク

| 目的 | ドキュメント |
|------|------------|
| **次に何をすべきか知りたい** | 📋 [ROADMAP.md](ROADMAP.md) |
| **システム全体像を理解したい** | 🏗️ [architecture/overview.md](architecture/overview.md) |
| **同期を実行したい** | 🔧 [operations/runbook.md](operations/runbook.md) |
| **テーブル定義を確認したい** | 🗃️ [database/table_design.md](database/table_design.md) |

---

## プロジェクト概要

**LIFETRACER** は個人の生活データ（健康・時間・支出）を統合し、長期運用に耐える分析基盤を提供する。

### 設計思想

| 原則 | 説明 |
|------|------|
| **60年運用** | PostgreSQL + Python + dbt は枯れた技術スタック |
| **テンプレート提供** | ユーザーが全リソースを所有し、提供者への依存なく運用可能 |
| **サービス非依存** | core層以降ではサービス名が消え、将来の移行に耐える |

### 現在のステータス

```
Phase 1: データ収集基盤  ✅ 完了
Phase 2: 本番運用       🔄 進行中
Phase 3: DWH構築       ⏳ 未着手
Phase 4: 可視化        ⏳ 未着手
```

---

## 実装済みデータソース

| サービス | ドメイン | 認証方式 | ステータス |
|---------|---------|---------|:----------:|
| [Toggl Track](data_sources/toggl.md) | 時間管理 | Basic Auth | ✅ 運用中 |
| [Google Calendar](data_sources/gcalendar.md) | 時間管理 | Service Account | ✅ 運用中 |
| [Zaim](data_sources/zaim.md) | 支出管理 | OAuth 1.0a | ✅ テスト済 |
| [Fitbit](data_sources/fitbit.md) | 健康管理 | OAuth 2.0 | ✅ テスト済 |
| [Tanita](data_sources/tanita.md) | 健康管理 | OAuth 2.0 | ✅ テスト済 |
| [Trello](data_sources/trello.md) | タスク管理 | API Key | ✅ 実装完了 |
| [TickTick](data_sources/ticktick.md) | タスク管理 | OAuth 2.0 | ✅ 実装完了 |
| [Airtable](data_sources/airtable.md) | マスタ管理 | PAT | ✅ 実装完了 |

**コード統計**: ~5160行 / 131テスト / カバレッジ ~90%

---

## ドキュメント構成

```
docs/
├── DESIGN.md           # ← このファイル（エントリーポイント）
├── ROADMAP.md          # ロードマップ・TODO・次のアクション
│
├── architecture/       # アーキテクチャ設計
│   ├── overview.md     # システム概要・データフロー
│   ├── dwh_layers.md   # DWH 4層設計（raw/staging/core/marts）
│   └── security.md     # 認証・暗号化
│
├── data_sources/       # データソース別詳細設計
│   ├── toggl.md
│   ├── gcalendar.md
│   ├── zaim.md
│   ├── fitbit.md
│   ├── tanita.md
│   ├── trello.md
│   ├── ticktick.md
│   └── airtable.md
│
├── database/           # DB設計
│   └── table_design.md # 全テーブル定義
│
└── operations/         # 運用
    └── runbook.md      # 実行手順・トラブルシュート
```

---

## 技術スタック

| レイヤー | 技術 | ステータス |
|---------|------|:----------:|
| データ収集 | Python 3.12+ | ✅ |
| データ変換 | dbt (SQL) | ⏳ |
| データベース | Supabase (PostgreSQL) | ✅ |
| ジョブ実行 | GitHub Actions | ⏳ |
| 可視化 | Grafana Cloud | ⏳ |
| 暗号化 | AES-256-GCM | ✅ |

---

## 変更履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 3.0.0 | 2025-12-02 | ドキュメント構成を刷新、ROADMAP.md追加 |
| 2.1.0 | 2025-12-02 | Basic_Designフォルダに分割 |
| 2.0.0 | 2025-12-01 | 全サービスPython実装完了 |
| 1.0.0 | 2024-11 | 初版作成 |
