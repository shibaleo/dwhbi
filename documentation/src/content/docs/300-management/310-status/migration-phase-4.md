---
title: "Phase 4: 新規プロジェクト作成"
description: ADR-005 で定義された新規プロジェクトのスケルトン作成
---

# Phase 4: 新規プロジェクト作成

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | ADR-005 で定義された新規プロジェクトのスケルトン作成 |
| 前提条件 | Phase 3 完了 |
| 成果物 | `packages/analyzer/`, `packages/adjuster/`, `packages/reporter/`, `packages/visualizer/` |

## タスク一覧

---

## 4.1 analyzer（Python ML プロジェクト）

### 4.1.1 ディレクトリ構造作成

```bash
mkdir -p packages/analyzer/{src/analyzer,tests,notebooks}
```

### 4.1.2 project.json 作成

```json
// packages/analyzer/project.json
{
  "name": "analyzer",
  "projectType": "application",
  "sourceRoot": "packages/analyzer/src",
  "targets": {
    "run": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/analyzer",
        "command": ".venv/Scripts/python -m analyzer"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/analyzer",
        "command": ".venv/Scripts/pytest tests/"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/analyzer",
        "command": ".venv/Scripts/ruff check src/"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/analyzer",
        "command": ".venv/Scripts/mypy src/"
      }
    }
  },
  "tags": ["scope:analyzer", "type:app"]
}
```

### 4.1.3 pyproject.toml 作成

```toml
# packages/analyzer/pyproject.toml
[project]
name = "analyzer"
version = "0.1.0"
description = "ML prediction analysis for time management"
requires-python = ">=3.12"
dependencies = [
    "pandas>=2.0.0",
    "lightgbm>=4.0.0",
    "scikit-learn>=1.3.0",
    "supabase>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov>=4.0.0",
    "ruff>=0.1.0",
    "mypy>=1.0.0",
    "jupyter>=1.0.0",
    "ipykernel>=6.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.mypy]
python_version = "3.12"
strict = true
```

### 4.1.4 .python-version 作成

```
3.12
```

### 4.1.5 src/analyzer/__init__.py 作成

```python
# packages/analyzer/src/analyzer/__init__.py
"""ML prediction analysis for time management."""

__version__ = "0.1.0"
```

### 4.1.6 src/analyzer/__main__.py 作成

```python
# packages/analyzer/src/analyzer/__main__.py
"""Entry point for running analyzer as a module."""

from analyzer.main import main

if __name__ == "__main__":
    main()
```

### 4.1.7 src/analyzer/main.py 作成

```python
# packages/analyzer/src/analyzer/main.py
"""Main entry point for analyzer."""

import argparse
from datetime import date


def main() -> None:
    """Run the analyzer."""
    parser = argparse.ArgumentParser(description="ML prediction analyzer")
    parser.add_argument(
        "--date",
        type=str,
        default=str(date.today()),
        help="Target date (YYYY-MM-DD)",
    )
    args = parser.parse_args()

    print(f"Running analyzer for date: {args.date}")
    # TODO: Implement analyzer logic


if __name__ == "__main__":
    main()
```

### 4.1.8 仮想環境セットアップ

```bash
cd packages/analyzer
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -e ".[dev]"
```

---

## 4.2 adjuster（Python 調整提案プロジェクト）

### 4.2.1 ディレクトリ構造作成

```bash
mkdir -p packages/adjuster/{src/adjuster,tests}
```

### 4.2.2 project.json 作成

```json
// packages/adjuster/project.json
{
  "name": "adjuster",
  "projectType": "application",
  "sourceRoot": "packages/adjuster/src",
  "targets": {
    "run": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/adjuster",
        "command": ".venv/Scripts/python -m adjuster"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/adjuster",
        "command": ".venv/Scripts/pytest tests/"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/adjuster",
        "command": ".venv/Scripts/ruff check src/"
      }
    }
  },
  "tags": ["scope:adjuster", "type:app"]
}
```

### 4.2.3 pyproject.toml 作成

```toml
# packages/adjuster/pyproject.toml
[project]
name = "adjuster"
version = "0.1.0"
description = "Adjustment proposal generator"
requires-python = ">=3.12"
dependencies = [
    "pandas>=2.0.0",
    "supabase>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "ruff>=0.1.0",
    "mypy>=1.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 4.2.4 src/adjuster/__init__.py 作成

```python
# packages/adjuster/src/adjuster/__init__.py
"""Adjustment proposal generator."""

__version__ = "0.1.0"
```

---

## 4.3 reporter（Typst PDF レポート生成）

### 4.3.1 ディレクトリ構造作成

```bash
mkdir -p packages/reporter/{src,templates,output}
```

### 4.3.2 project.json 作成

```json
// packages/reporter/project.json
{
  "name": "reporter",
  "projectType": "application",
  "sourceRoot": "packages/reporter/src",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/reporter",
        "command": "typst compile templates/daily.typ output/daily.pdf"
      }
    },
    "watch": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/reporter",
        "command": "typst watch templates/daily.typ output/daily.pdf"
      }
    },
    "generate": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/reporter",
        "command": "npm run generate"
      }
    }
  },
  "tags": ["scope:reporter", "type:app"]
}
```

### 4.3.3 package.json 作成

```json
// packages/reporter/package.json
{
  "name": "@repo/reporter",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "typst compile templates/daily.typ output/daily.pdf",
    "watch": "typst watch templates/daily.typ output/daily.pdf",
    "generate": "node src/generate.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@repo/database-types": "workspace:*"
  }
}
```

### 4.3.4 templates/daily.typ 作成

```typst
// packages/reporter/templates/daily.typ
#set document(
  title: "Daily Report",
  author: "DWH+BI System",
)

#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2cm),
)

#set text(
  font: "Noto Sans JP",
  size: 10pt,
)

= Daily Report

#datetime.today().display("[year]-[month]-[day]")

== Summary

// TODO: Add report content

== Time Breakdown

// TODO: Add time breakdown chart using CeTZ
```

### 4.3.5 .gitignore 追加

```gitignore
# packages/reporter/.gitignore
output/*.pdf
```

---

## 4.4 visualizer（Grafana ダッシュボード）

### 4.4.1 ディレクトリ構造作成

```bash
mkdir -p packages/visualizer/{provisioning/datasources,provisioning/dashboards,dashboards}
```

### 4.4.2 project.json 作成

```json
// packages/visualizer/project.json
{
  "name": "visualizer",
  "projectType": "application",
  "sourceRoot": "packages/visualizer",
  "targets": {
    "up": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/visualizer",
        "command": "docker-compose up -d"
      }
    },
    "down": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/visualizer",
        "command": "docker-compose down"
      }
    },
    "logs": {
      "executor": "nx:run-commands",
      "options": {
        "cwd": "packages/visualizer",
        "command": "docker-compose logs -f"
      }
    }
  },
  "tags": ["scope:visualizer", "type:app"]
}
```

### 4.4.3 docker-compose.yml 作成

```yaml
# packages/visualizer/docker-compose.yml
version: '3.8'

services:
  grafana:
    image: grafana/grafana:latest
    container_name: dwh-grafana
    ports:
      - "3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana
      - ./provisioning:/etc/grafana/provisioning
      - ./dashboards:/var/lib/grafana/dashboards
    environment:
      - GF_SECURITY_ADMIN_USER=${GRAFANA_ADMIN_USER:-admin}
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    env_file:
      - .env

volumes:
  grafana-data:
```

### 4.4.4 provisioning/datasources/supabase.yml 作成

```yaml
# packages/visualizer/provisioning/datasources/supabase.yml
apiVersion: 1

datasources:
  - name: Supabase
    type: postgres
    url: ${DB_HOST}:${DB_PORT}
    database: ${DB_NAME}
    user: ${DB_USER}
    secureJsonData:
      password: ${DB_PASSWORD}
    jsonData:
      sslmode: require
      postgresVersion: 1500
      timescaledb: false
    isDefault: true
    editable: false
```

### 4.4.5 provisioning/dashboards/default.yml 作成

```yaml
# packages/visualizer/provisioning/dashboards/default.yml
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    options:
      path: /var/lib/grafana/dashboards
```

### 4.4.6 .env.example 作成

```bash
# packages/visualizer/.env.example
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin

DB_HOST=db.xxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=xxx
```

---

## 検証手順

### 各プロジェクトの動作確認

```bash
# analyzer
cd packages/analyzer
python -m venv .venv
.venv/Scripts/activate
pip install -e ".[dev]"
python -m analyzer --help

# adjuster
cd packages/adjuster
python -m venv .venv
.venv/Scripts/activate
pip install -e ".[dev]"

# reporter（Typst がインストールされている場合）
cd packages/reporter
npm install
typst compile templates/daily.typ output/daily.pdf

# visualizer
cd packages/visualizer
docker-compose up -d
# http://localhost:3000 で確認
docker-compose down
```

### 依存グラフ確認

```bash
npx nx graph
```

### チェックリスト

- [ ] `packages/analyzer/` が作成され、Python パッケージとして動作する
- [ ] `packages/adjuster/` が作成され、Python パッケージとして動作する
- [ ] `packages/reporter/` が作成され、Typst コンパイルが可能
- [ ] `packages/visualizer/` が作成され、Docker Compose で起動可能
- [ ] 各プロジェクトに `project.json` がある
- [ ] `npx nx graph` で新規プロジェクトが表示される

## ロールバック手順

```bash
# 新規プロジェクトを削除
rm -rf packages/analyzer packages/adjuster packages/reporter packages/visualizer
```

## 完了条件

以下がすべて満たされたら Phase 4 完了:

1. 4つの新規プロジェクトが作成されている
2. 各プロジェクトにスケルトンコードがある
3. 各プロジェクトの基本的な実行ができる
4. Nx グラフに全プロジェクトが表示される

## 次のフェーズ

[Phase 5: テスト構成の整理](/300-management/310-status/migration-phase-5)

## 関連ドキュメント

- [モノレポ移行計画](/300-management/310-status/migration-plan) - 全体計画
- [Phase 3: 既存プロジェクトの移行](/300-management/310-status/migration-phase-3) - 前のフェーズ
- [ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure) - 設計決定
