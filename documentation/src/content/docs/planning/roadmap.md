---
title: ロードマップ
description: 開発フェーズと進捗
---

# ロードマップ

## 現在のステータス

```
Phase 0: API Token系     ████████████████████ 100% ✅ 完了
Phase 1: OAuth系         ████████████████████ 100% ✅ 完了
Phase 2: DWH構築(staging)████████████████░░░░  80% 🔄 進行中
Phase 3: 可視化          ░░░░░░░░░░░░░░░░░░░░   0% ⏳ 未着手
Phase 4: 本番運用強化    ░░░░░░░░░░░░░░░░░░░░   0% ⏳ 未着手
Phase 5: ビジュアルETL   ░░░░░░░░░░░░░░░░░░░░   0% ⏳ 未着手
```

## Phase 0: API Token系 ✅ 完了

| バージョン | サービス | 認証方式 | ステータス |
|-----------|---------|---------|:----------:|
| v0.1.0 | Toggl Track | API Token | ✅ |
| v0.2.0 | Trello | API Key + Token | ✅ |
| v0.3.0 | Airtable | PAT | ✅ |

## Phase 1: OAuth系 ✅ 完了

| バージョン | サービス | 認証方式 | ステータス |
|-----------|---------|---------|:----------:|
| v0.4.0 | Fitbit | OAuth 2.0 | ✅ |
| v0.5.0 | Tanita Health Planet | OAuth 2.0 | ✅ |
| v0.6.0 | Google Calendar | OAuth 2.0 | ✅ |
| v0.7.0 | TickTick | OAuth 2.0 | ✅ |
| v0.8.0 | Zaim | OAuth 1.0a | ✅ |

## Phase 2: DWH構築（staging層）🔄 進行中

**目標**: dbtによるstaging層の構築

| タスク | ステータス | 備考 |
|--------|:----------:|------|
| raw層テーブル作成（Toggl） | ✅ | 9テーブル + RLS |
| raw層パイプライン（Toggl） | ✅ | api_client, sync_*, orchestrator |
| dbtプロジェクト初期化 | ✅ | transform/, profiles.yml, packages.yml |
| staging層モデル（Toggl） | ✅ | 9モデル（stg_toggl_track__*） |
| 型変換・正規化ロジック | ✅ | JSONB→型付きカラム、NULL処理 |
| security_invoker設定 | ✅ | post-hook で自動設定 |
| GitHub Actionsワークフロー | ✅ | dbt-run.yml, sync-daily.yml |
| テスト・ドキュメント | ✅ | 47テスト全パス |
| core層ビュー作成 | ⏳ | 必要に応じて |
| marts層ビュー作成 | ⏳ | 必要に応じて |

**完了条件**: `SELECT * FROM staging.stg_toggl_track__time_entries` が動作 ✅

## Phase 3: 可視化 ⏳ 未着手

**目標**: BIツールで日々の状態を確認

| タスク | ステータス |
|--------|:----------:|
| 可視化ツール選定 | ✅ |
| 健康ダッシュボード | ⏳ |
| 生産性ダッシュボード | ⏳ |
| 支出ダッシュボード | ⏳ |

**完了条件**: 毎朝ダッシュボードで前日の状態を確認できる

## Phase 4: 本番運用強化 ⏳ 未着手

**目標**: 安定した自動同期と監視

| タスク | ステータス |
|--------|:----------:|
| 同期失敗アラート | ⏳ |
| バックアップ手順 | ⏳ |
| 障害対応手順 | ⏳ |

**完了条件**: 障害対応手順完備 + 通知設定 + 1週間安定稼働

## Phase 5: ビジュアルETLエディタ ⏳ 未着手

**目標**: コード不要でcore/marts層を動的構築

| タスク | ステータス |
|--------|:----------:|
| ノードエディタUI | ⏳ |
| SQL生成エンジン | ⏳ |
| VIEW自動作成 | ⏳ |
| プレビュー機能 | ⏳ |

**完了条件**: GUIでクロスドメイン分析ビューを作成できる

## v1.0.0: 正式リリース

- 全8サービス対応完了 ✅
- 管理ダッシュボード安定 ✅
- ドキュメント完備 ✅
- マスタ管理画面作成 ⏳
- staging/core/marts層実装 ⏳

---

## 今すぐやること（Next Actions）

| # | タスク | 優先度 | ステータス | 備考 |
|---|--------|:------:|:----------:|------|
| 1 | dbtプロジェクト初期化 | 🔴 高 | ✅ | transform/ディレクトリ |
| 2 | Toggl staging層モデル作成 | 🔴 高 | ✅ | 9モデル + 47テスト |
| 3 | 他サービスのstaging層モデル | 🟡 中 | ⏳ | Fitbit, Zaim等 |
| 4 | 管理画面にGitHub PAT登録機能 | 🟡 中 | ⏳ | Supabase Vaultに保存 |
| 5 | 同期実行ボタン実装 | 🟡 中 | ⏳ | Vercel → GitHub Actions dispatch |

### 同期実行ボタン詳細

管理画面から手動で同期を実行できる機能：

```
[管理画面] → [Vercel Serverless] → [GitHub Actions dispatch API] → [sync workflow]
```

**実装タスク**:
1. GitHub PAT を Supabase Vault に保存するUI
2. `/api/dispatch/toggl` エンドポイント作成
3. `POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`
4. 管理画面に「同期実行」ボタン追加

---

*最終更新: 2025-12-03*
