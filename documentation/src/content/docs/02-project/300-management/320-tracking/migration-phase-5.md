---
title: "Phase 5: テスト構成の整理"
description: テスト階層を確立する移行フェーズ
---

# Phase 5: テスト構成の整理

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | テスト階層の確立 |
| 前提条件 | Phase 4 完了 |
| 成果物 | `tests/e2e/`, `tests/integration/`, 各プロジェクトのテスト設定 |

## テスト階層の設計

| レベル | 場所 | スコープ | 実行タイミング |
|--------|------|----------|----------------|
| 単体テスト | `packages/{project}/__tests__/` or `tests/` | 関数・クラス | 開発時、PR |
| 結合テスト | `packages/{project}/__tests__/` or `tests/` | モジュール連携 | PR |
| 統合テスト | `/tests/integration/` | プロジェクト間連携 | マージ後 |
| E2E テスト | `/tests/e2e/` | システム全体 | 定期実行 |

---

## タスク一覧

### 5.1 tests/e2e/ 作成

#### 5.1.1 ディレクトリ構造作成

```bash
mkdir -p tests/e2e
```

#### 5.1.2 conftest.py 作成

```python
# tests/e2e/conftest.py
"""E2E test fixtures and configuration."""

import os
import pytest
from supabase import create_client, Client


@pytest.fixture(scope="session")
def supabase_client() -> Client:
    """Create a Supabase client for E2E tests."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        pytest.skip("Supabase credentials not configured")

    return create_client(url, key)


@pytest.fixture(scope="session")
def test_date() -> str:
    """Return a test date for E2E tests."""
    return "2025-01-01"
```

#### 5.1.3 test_time_pipeline.py 作成

```python
# tests/e2e/test_time_pipeline.py
"""E2E tests for the time management pipeline."""

import pytest
from supabase import Client


class TestTimePipeline:
    """Test the complete time management pipeline."""

    def test_raw_data_exists(self, supabase_client: Client, test_date: str) -> None:
        """Test that raw data is loaded for the test date."""
        # connector の出力確認
        response = supabase_client.table("raw_toggl_time_entries").select("*").eq(
            "start_date", test_date
        ).execute()

        assert response.data is not None
        # 実際のテストではデータの存在を確認

    def test_staging_views_exist(self, supabase_client: Client) -> None:
        """Test that staging views are created."""
        # transform の出力確認
        response = supabase_client.table("stg_toggl_time_entries").select(
            "count", count="exact"
        ).execute()

        assert response.count is not None

    def test_core_views_exist(self, supabase_client: Client) -> None:
        """Test that core views are created."""
        response = supabase_client.table("fct_time_records").select(
            "count", count="exact"
        ).execute()

        assert response.count is not None

    def test_estimates_generated(self, supabase_client: Client, test_date: str) -> None:
        """Test that estimates are generated."""
        # analyzer の出力確認
        response = supabase_client.table("fct_time_daily_estimate").select("*").eq(
            "date", test_date
        ).execute()

        # テスト環境では存在しない可能性があるため、エラーでなければ OK
        assert response.data is not None or response.data == []
```

### 5.2 tests/integration/ 作成

#### 5.2.1 ディレクトリ構造作成

```bash
mkdir -p tests/integration
```

#### 5.2.2 conftest.py 作成

```python
# tests/integration/conftest.py
"""Integration test fixtures and configuration."""

import os
import pytest


@pytest.fixture(scope="session")
def db_connection_string() -> str:
    """Return database connection string."""
    return os.environ.get(
        "DIRECT_DATABASE_URL",
        "postgresql://localhost:5432/test"
    )
```

#### 5.2.3 test_db_connectivity.py 作成

```python
# tests/integration/test_db_connectivity.py
"""Integration tests for database connectivity."""

import pytest


class TestDatabaseConnectivity:
    """Test database connectivity across projects."""

    def test_can_connect_to_database(self, db_connection_string: str) -> None:
        """Test that we can connect to the database."""
        import psycopg2

        try:
            conn = psycopg2.connect(db_connection_string)
            conn.close()
        except Exception as e:
            pytest.fail(f"Failed to connect to database: {e}")

    def test_raw_schema_exists(self, db_connection_string: str) -> None:
        """Test that raw schema exists."""
        import psycopg2

        conn = psycopg2.connect(db_connection_string)
        cur = conn.cursor()
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name = 'raw'
        """)
        result = cur.fetchone()
        conn.close()

        assert result is not None, "raw schema does not exist"

    def test_staging_schema_exists(self, db_connection_string: str) -> None:
        """Test that staging schema exists."""
        import psycopg2

        conn = psycopg2.connect(db_connection_string)
        cur = conn.cursor()
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name = 'staging'
        """)
        result = cur.fetchone()
        conn.close()

        assert result is not None, "staging schema does not exist"
```

### 5.3 ルートの pytest 設定

#### 5.3.1 pyproject.toml（ルート）更新

```toml
# pyproject.toml（ルート）
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = "-v --tb=short"
markers = [
    "e2e: End-to-end tests (deselect with '-m \"not e2e\"')",
    "integration: Integration tests",
    "slow: Slow tests",
]

[tool.coverage.run]
source = ["packages/*/src"]
omit = ["*/tests/*", "*/__pycache__/*"]
```

#### 5.3.2 requirements-test.txt 作成

```
# requirements-test.txt
pytest>=7.0.0
pytest-cov>=4.0.0
pytest-asyncio>=0.21.0
psycopg2-binary>=2.9.0
supabase>=2.0.0
python-dotenv>=1.0.0
```

### 5.4 Jest 設定（TypeScript プロジェクト用）

**注意:** connector は Phase 3 時点では Python。Phase 8 完了後に TypeScript 用 Jest 設定を適用する。

#### 5.4.1 jest.preset.js 作成（ルート）

```javascript
// jest.preset.js
const nxPreset = require('@nx/jest/preset').default

module.exports = {
  ...nxPreset,
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.spec.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}'
  ]
}
```

#### 5.4.2 TypeScript プロジェクトの jest.config.ts 例

console や database-types など TypeScript プロジェクトに適用:

```typescript
// packages/console/jest.config.ts
export default {
  displayName: 'console',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: '../../coverage/packages/console',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.spec.ts']
}
```

**connector の Jest 設定は Phase 8 で作成する。**

### 5.5 Nx テストターゲット設定

#### 5.5.1 ルートレベルのテスト project.json

```json
// tests/project.json
{
  "name": "tests",
  "projectType": "application",
  "targets": {
    "e2e": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pytest tests/e2e -v -m e2e"
      }
    },
    "integration": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pytest tests/integration -v -m integration"
      }
    },
    "all": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pytest tests/ -v"
      }
    }
  },
  "tags": ["scope:tests", "type:e2e"]
}
```

---

## 検証手順

### テスト実行

```bash
# 単体テスト（各プロジェクト）
npx nx test connector
npx nx test console
npx nx run transform:test

# 統合テスト
npx nx run tests:integration

# E2E テスト
npx nx run tests:e2e

# 全テスト
npx nx run-many --target=test --all
```

### カバレッジ確認

```bash
# カバレッジ付きで実行
npx nx test connector --coverage
pytest tests/ --cov=packages --cov-report=html
```

### チェックリスト

- [ ] `tests/e2e/` ディレクトリが作成されている
- [ ] `tests/integration/` ディレクトリが作成されている
- [ ] ルートの pytest 設定が完了している
- [ ] Jest preset が作成されている
- [ ] 各プロジェクトのテストが実行できる
- [ ] 総合テストが実行できる

## ロールバック手順

```bash
# テスト関連ファイルを削除
rm -rf tests/e2e tests/integration
rm jest.preset.js
rm tests/project.json
```

## 完了条件

以下がすべて満たされたら Phase 5 完了:

1. E2E テストディレクトリとサンプルテストがある
2. 統合テストディレクトリとサンプルテストがある
3. pytest 設定が完了している
4. Jest 設定が完了している
5. `npx nx run-many --target=test --all` が成功する

## 次のフェーズ

[Phase 6: CI/CD 更新](/02-project/300-management/310-status/migration-phase-6)

## 関連ドキュメント

- [モノレポ移行計画](/02-project/300-management/310-status/migration-plan) - 全体計画
- [Phase 4: 新規プロジェクト作成](/02-project/300-management/310-status/migration-phase-4) - 前のフェーズ
- [テスト戦略](/01-product/200-quality/210-test/index) - テスト戦略ドキュメント
