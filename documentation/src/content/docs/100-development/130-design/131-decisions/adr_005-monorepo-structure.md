---
title: ADR-005 モノレポ構成
description: 複数プロジェクトを単一リポジトリで管理する構成の設計決定
---

# ADR-005: モノレポ構成

## ステータス

採用（2025-12-07）

## コンテキスト

本リポジトリは複数の技術スタック（Python、Node.js、dbt）で構成される。当初はルートに `pyproject.toml` や `.venv` を配置していたが、以下の問題が発生していた:

### 問題点

1. **依存関係の混在**
   - `requirements.txt` に pipelines 用と dbt 用の依存が混在
   - 将来 analyzer プロジェクトを追加すると LightGBM 等の ML ライブラリも混入

2. **仮想環境の競合リスク**
   - 単一の `.venv` を複数プロジェクトで共有
   - パッケージバージョン競合のリスク

3. **プロジェクト境界が曖昧**
   - `tests/` がどのプロジェクト用か不明
   - `scripts/` が dbt 用だがルートに配置
   - 新規プロジェクト追加時のパターンが不明確

4. **CI/CD の複雑化**
   - 変更検知が困難（どのプロジェクトが変更されたか）
   - 全プロジェクトを毎回ビルド・テストする非効率

## 決定

**各プロジェクトを自己完結型に分離**し、以下の構成を採用する。

### ディレクトリ構成

```
supabase-sync-jobs/
├── .github/                 # GitHub Actions（全体）
├── .env                     # 共通環境変数
├── README.md
│
├── tests/                   # 総合テスト（プロジェクト横断 E2E・統合）
│   ├── e2e/
│   └── integration/
│
├── console/                 # Node.js (Next.js) - 管理コンソール
│   ├── package.json
│   ├── src/
│   └── __tests__/           # 単体テスト
│
├── documentation/           # Node.js (Astro) - ドキュメント
│   └── package.json
│
├── supabase/                # Supabase マイグレーション
│   └── migrations/
│
├── pipelines/               # Python - Extract/Load
│   ├── pyproject.toml
│   ├── .python-version
│   ├── .venv/
│   ├── src/pipelines/
│   └── tests/               # 単体・結合テスト
│
├── transform/               # dbt - Transform
│   ├── dbt_project.yml
│   ├── profiles.yml
│   ├── models/
│   ├── seeds/
│   ├── tests/               # dbt テスト
│   └── scripts/             # dbt 実行スクリプト
│
└── analyzer/                # Python - ML分析（新規）
    ├── pyproject.toml
    ├── .python-version
    ├── .venv/
    ├── src/analyzer/
    ├── transform/           # analyzer 用 dbt
    ├── notebooks/
    └── tests/               # 単体・結合テスト
```

### 設計原則

#### 1. 自己完結型プロジェクト

各プロジェクトは独自の:
- パッケージマネージャ設定（`pyproject.toml` / `package.json`）
- 仮想環境（`.venv` / `node_modules`）
- テストディレクトリ
- スクリプト

を持ち、単独で開発・テスト・実行できる。

#### 2. テストの階層化

| レベル | 場所 | スコープ |
|--------|------|----------|
| 単体テスト | 各プロジェクト `tests/` | 関数・クラス単位 |
| 結合テスト | 各プロジェクト `tests/` | プロジェクト内モジュール連携 |
| 総合テスト | ルート `tests/` | プロジェクト横断（E2E） |

#### 3. 共有リソースの最小化

- `.env`: 環境変数のみ共有
- `supabase/migrations/`: DB スキーマは全プロジェクト共通
- それ以外は各プロジェクトに閉じる

## 理由

### プロジェクト分離を選んだ理由

| 観点 | 共有（現状） | 分離（採用） |
|------|-------------|-------------|
| 依存管理 | 競合リスクあり | プロジェクト毎に独立 |
| CI/CD | 全体ビルド必須 | 変更プロジェクトのみ |
| 新規追加 | パターン不明確 | テンプレート化可能 |
| 開発体験 | 設定混乱 | 明確な境界 |

### ルートに tests/ を残す理由

- E2E テスト（pipelines → transform → analyzer の一連フロー）
- 統合テスト（複数プロジェクト連携の検証）
- 単一プロジェクトに属さないテストの受け皿

### analyzer/ 内に transform/ を持つ理由

- analyzer スキーマ用の中間テーブル・ビューは analyzer プロジェクトの責務
- メインの transform/ は staging/core/marts を担当
- 関心の分離を維持

## 却下した代替案

### 案1: 完全分離（マルチリポジトリ）

```
dwh-pipelines/
dwh-transform/
dwh-analyzer/
dwh-console/
```

**却下理由:**
- リポジトリ間の同期が困難
- DB マイグレーションの管理が複雑化
- 小規模プロジェクトには過剰

### 案2: 現状維持（ルートに pyproject.toml）

**却下理由:**
- 問題点が解決されない
- analyzer 追加で更に複雑化

### 案3: Nx/Turborepo 導入

**却下理由:**
- 学習コストが高い
- 現状の規模では過剰
- 将来的に必要になれば導入を検討

## 影響

### マイグレーション作業

1. `pyproject.toml`, `.python-version`, `.venv` を `pipelines/` に移動
2. `requirements.txt` を削除（`pyproject.toml` に統合済み）
3. `scripts/` の dbt スクリプトを `transform/scripts/` に移動
4. `tests/pipelines/` を `pipelines/tests/` に移動
5. ルート `tests/` を E2E/統合テスト用に再構成
6. `bin/`, `setup_python.sh` を整理・削除

### CI/CD 更新

- プロジェクト毎の変更検知を追加
- 変更されたプロジェクトのみビルド・テスト

### 開発フロー

```bash
# pipelines の開発
cd pipelines
source .venv/bin/activate  # または uv/poetry を使用
pytest tests/

# transform の開発
cd transform
dbt run

# analyzer の開発（新規）
cd analyzer
source .venv/bin/activate
python scripts/run_estimate.py
```

## 関連ドキュメント

- [リポジトリ構成](/100-development/120-specifications/121-overview/repository-structure)
- [001 推定値計算ロジック](/100-development/120-specifications/123-transform/logic/time/001-estimation) - analyzer プロジェクト構成
