---
title: ロードマップ
description: 開発フェーズと進捗
---

# ロードマップ

## 現在のステータス

```
v0.1.0 MVP      ██████████████░░░░░░  70% 🔄 進行中
v0.2.0 運用安定  ░░░░░░░░░░░░░░░░░░░░   0% ⏳ 未着手
v1.0.0 分析基盤  ░░░░░░░░░░░░░░░░░░░░   0% ⏳ 未着手
```

---

## v0.1.0: MVP（分析可能な状態）

**目標**: 最低限の可視化とLLMによる分析を可能にする

### 完了条件

- [x] 主要サービスの同期実装（8サービス）
- [x] 管理コンソール（OAuth、Vault連携）
- [x] Toggl Track staging層
- [x] Google Calendar staging層
- [ ] Fitbit staging層
- [ ] Zaim staging層
- [ ] Tanita staging層
- [ ] Grafana ダッシュボード（staging確認用）
- [ ] LLM分析可能な状態

### 進捗

| タスク | ステータス | 備考 |
|--------|:----------:|------|
| 8サービス同期 | ✅ | raw層完了 |
| 管理コンソール | ✅ | OAuth、Vault、GitHub Actions連携 |
| Toggl staging層 | ✅ | 9モデル + 47テスト |
| Google Calendar staging層 | ✅ | 4モデル + 29テスト + seed |
| **core層（時間統合）** | ✅ | fct_time_records_actual/plan/unified + dim_day_types（43テスト） |
| Fitbit staging層 | ⏳ | **次の作業** |
| Zaim staging層 | ⏳ | |
| Tanita staging層 | ⏳ | |
| Grafana（staging確認用） | ⏳ | データ品質チェック |

---

## v0.1.x: staging層拡充

v0.1.0 リリース後、必要に応じて追加：

| タスク | 優先度 | 備考 |
|--------|:------:|------|
| Trello staging層 | 🟢 低 | プロジェクト管理 |
| TickTick staging層 | 🟢 低 | タスク管理 |
| Airtable staging層 | 🟢 低 | マスタ管理 |

---

## v0.2.0: 運用安定化

**目標**: 日常の運用に乗せる

### 完了条件

- [ ] 全サービスのstaging層完了
- [ ] サービス追加・アップデート戦略策定
- [ ] 日常運用フロー確立
- [ ] アラート/監視設定
- [ ] 1週間以上の安定稼働

### タスク

| タスク | ステータス | 備考 |
|--------|:----------:|------|
| 残りのstaging層 | ⏳ | 5サービス |
| 運用フロー文書化 | ⏳ | |
| アラート設定 | ⏳ | Slack/Discord |
| 障害対応手順 | ⏳ | |

---

## v1.0.0: 分析基盤完成（必要に応じて）

**目標**: 高度な分析と可視化

### 完了条件

- [x] core層設計・実装（時間管理）
- [ ] core層拡張（他ドメイン）
- [ ] marts層設計・実装
- [ ] Grafana ダッシュボード（分析用）
- [ ] クロスドメイン分析が可能
- [ ] 日常的にダッシュボードを活用

### タスク

| タスク | ステータス | 備考 |
|--------|:----------:|------|
| core層（時間管理） | ✅ | fct_time_records_*, dim_day_types |
| core層（他ドメイン） | ⏳ | 必要性が明確になってから |
| marts層設計 | ⏳ | 必要性が明確になってから |
| Grafana（分析用） | ⏳ | インサイト、KPI |

### ダッシュボード構成

| ダッシュボード | 対象レイヤー | 目的 | バージョン |
|--------------|-------------|------|-----------|
| staging確認用 | staging | データ品質チェック、同期状況 | v0.1.0 |
| 分析用 | core/marts | インサイト、KPI、トレンド | v1.0.0 |

---

## 将来構想（Backlog）

| 機能 | 優先度 | 備考 |
|------|:------:|------|
| **analyzer プロジェクト** | 高 | estimate 自動計算（LightGBM、[123 推定値計算ロジック](/01-product/100-development/120-specifications/123-transform/logic/time/001-estimation#実装ステータス)） |
| **console.target GUI** | 高 | target の管理画面 CRUD / SCD Type 2（[123 目標値調整ロジック](/01-product/100-development/120-specifications/123-transform/logic/time/002-adjust-target-by-estimate#target-テーブル設計console-スキーマ--scd-type-2)） |
| **actual 列追加** | 高 | project_name, project_color_hex（[123 時間記録actual](/01-product/100-development/120-specifications/123-transform/schema/core/001-time-records-actual)） |
| **analyzer スキーマ** | 高 | 分析過程の中間テーブル・ビュー |
| **マルチドメイン分析** | 中 | 時間・金銭・健康の統合分析 |
| ビジュアルETLエディタ | 低 | core/marts層をGUIで構築 |
| 追加サービス連携 | 低 | Strava, Garmin, YouTube等 |
| HL7 FHIR標準化 | 低 | 健康データの相互運用性 |

### スキーマ構成（計画）

```
raw       ← 外部 API 生データ（自動同期）       ✅ 実装済み
staging   ← クリーニング済み（dbt ビュー）      ✅ 実装済み
core      ← 最終出力（actual, plan）           ✅ 実装済み
          ← estimate（JSONB スナップショット）  ⏳ 未実装
console   ← ユーザー操作（target: SCD Type 2） ⏳ 未実装
analyzer  ← 分析過程の中間テーブル             ⏳ 未実装
seeds     ← マスタデータ（CSV）               ✅ 実装済み
marts     ← 分析・可視化用                    ⏳ 未実装
```

### プロジェクト構成（計画）

| プロジェクト | 役割 | 出力スキーマ | ステータス |
|-------------|------|-------------|:----------:|
| `pipelines/` | Extract/Load | raw | ✅ |
| `transform/` | Transform | staging, core, marts | ✅ (marts未実装) |
| `analyzer/` | ML分析 | analyzer → core | ⏳ |
| `console/` | 管理コンソール | console | ✅ |
| `documentation/` | ドキュメント | - | ✅ |

詳細は [121 リポジトリ構成](/01-product/100-development/120-specifications/121-overview/repository-structure) を参照。設計決定の理由は [131 ADR-005](/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure) を参照。

---

## サービス別 staging層 進捗

| サービス | raw層 | staging層 | v0.1.0必須 |
|---------|:-----:|:---------:|:----------:|
| Toggl Track | ✅ | ✅ | ✅ |
| Google Calendar | ✅ | ✅ | ✅ |
| Fitbit | ✅ | ⏳ | ✅ |
| Zaim | ✅ | ⏳ | ✅ |
| Tanita | ✅ | ⏳ | ✅ |
| Trello | ✅ | ⏳ | - |
| TickTick | ✅ | ⏳ | - |
| Airtable | ✅ | ⏳ | - |

---

## 今すぐやること（Next Actions）

| # | タスク | 備考 |
|---|--------|------|
| 1 | Fitbit staging層 | v0.1.0 必須 |
| 2 | Zaim staging層 | v0.1.0 必須 |
| 3 | Tanita staging層 | v0.1.0 必須 |
| 4 | Grafana ダッシュボード（staging確認用） | v0.1.0 必須 |
| 5 | v0.1.0 リリース | |

---

*最終更新: 2025-12-07*
