---
title: Tanita Health Planet コネクタ実装計画
description: 仕様書に基づいた Tanita Health Planet コネクタの実装計画
---

# Tanita Health Planet コネクタ実装計画

## 概要

[Tanita Health Planet コネクタ設計](/01-product/100-development/130-design/connector-tanita-health-planet) および [仕様書](/01-product/100-development/120-specifications/122-pipelines/services/tanita-health-planet) に基づき、既存テーブルを新設計に移行し、TypeScript コネクタを実装する。

## 現状

### 既存テーブル（raw スキーマ）

| テーブル | 構造 | 状態 |
|---------|------|------|
| `raw.tanita_body_composition` | カラム定義型（measured_at, weight, body_fat_percent, model, synced_at） | 削除予定 |
| `raw.tanita_blood_pressure` | カラム定義型（measured_at, systolic, diastolic, pulse, model, synced_at） | 削除予定 |
| `raw.tanita_steps` | カラム定義型（measured_at, steps, model, synced_at） | 削除予定（未使用） |

### 新テーブル（設計書）

| テーブル | 構造 | 状態 |
|---------|------|------|
| `raw.tanita_health_planet__body_composition` | JSONB型（source_id, data, synced_at, api_version） | 新規作成 |
| `raw.tanita_health_planet__blood_pressure` | JSONB型（source_id, data, synced_at, api_version） | 新規作成 |

---

## 実装フェーズ

### Phase 1: データベースマイグレーション

**目的:** 新テーブル作成・データ移行・旧テーブル削除

#### 1.1 新テーブル作成

| # | タスク | 詳細 |
|---|--------|------|
| 1.1.1 | マイグレーションファイル作成 | `supabase/migrations/` に新規ファイル作成 |
| 1.1.2 | `raw.tanita_health_planet__body_composition` 作成 | JSONB構造、source_id UNIQUE制約 |
| 1.1.3 | `raw.tanita_health_planet__blood_pressure` 作成 | JSONB構造、source_id UNIQUE制約 |
| 1.1.4 | インデックス作成 | synced_at インデックス |

**マイグレーションSQL:**

```sql
-- 体組成データ
CREATE TABLE raw.tanita_health_planet__body_composition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_tanita_hp_body_composition_synced_at
    ON raw.tanita_health_planet__body_composition(synced_at);

-- 血圧データ
CREATE TABLE raw.tanita_health_planet__blood_pressure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL UNIQUE,
    data JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    api_version TEXT DEFAULT 'v1'
);

CREATE INDEX idx_tanita_hp_blood_pressure_synced_at
    ON raw.tanita_health_planet__blood_pressure(synced_at);
```

#### 1.2 データ移行

| # | タスク | 詳細 |
|---|--------|------|
| 1.2.1 | 体組成データ移行 | 既存データを JSONB 形式に変換して挿入 |
| 1.2.2 | 血圧データ移行 | 既存データを JSONB 形式に変換して挿入 |
| 1.2.3 | 移行検証 | レコード数・データ整合性の確認 |

**データ移行SQL:**

```sql
-- 体組成データ移行
INSERT INTO raw.tanita_health_planet__body_composition (source_id, data, synced_at)
SELECT
    to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_id,
    jsonb_build_object(
        'weight', weight,
        'body_fat_percent', body_fat_percent,
        'model', model,
        '_measured_at_jst', to_char(measured_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"'),
        '_migrated_from', 'tanita_body_composition'
    ) as data,
    synced_at
FROM raw.tanita_body_composition
ON CONFLICT (source_id) DO NOTHING;

-- 血圧データ移行
INSERT INTO raw.tanita_health_planet__blood_pressure (source_id, data, synced_at)
SELECT
    to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_id,
    jsonb_build_object(
        'systolic', systolic,
        'diastolic', diastolic,
        'pulse', pulse,
        'model', model,
        '_measured_at_jst', to_char(measured_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"'),
        '_migrated_from', 'tanita_blood_pressure'
    ) as data,
    synced_at
FROM raw.tanita_blood_pressure
ON CONFLICT (source_id) DO NOTHING;
```

#### 1.3 旧テーブル削除

| # | タスク | 詳細 |
|---|--------|------|
| 1.3.1 | `raw.tanita_body_composition` 削除 | DROP TABLE |
| 1.3.2 | `raw.tanita_blood_pressure` 削除 | DROP TABLE |
| 1.3.3 | `raw.tanita_steps` 削除 | DROP TABLE（未使用） |

**削除SQL:**

```sql
DROP TABLE IF EXISTS raw.tanita_body_composition;
DROP TABLE IF EXISTS raw.tanita_blood_pressure;
DROP TABLE IF EXISTS raw.tanita_steps;
```

---

### Phase 2: TypeScript コネクタ実装

**目的:** 設計書に基づいた TypeScript コネクタの実装

**前提条件:** Phase 1 完了、packages/connector が TypeScript 対応済み

#### 2.1 ディレクトリ構成作成

```
packages/connector/src/services/tanita-health-planet/
├── index.ts                      # Public exports
├── api-client.ts                 # API 通信・OAuth
├── orchestrator.ts               # 同期オーケストレーター
├── sync-body-composition.ts      # 体組成データ同期
├── sync-blood-pressure.ts        # 血圧データ同期
└── cli.ts                        # CLI エントリポイント
```

#### 2.2 API クライアント実装

| # | タスク | 詳細 |
|---|--------|------|
| 2.2.1 | Vault 認証情報取得 | `credentials-vault.ts` と連携 |
| 2.2.2 | OAuth トークンリフレッシュ | 有効期限30分前に自動リフレッシュ |
| 2.2.3 | API リクエスト関数 | `fetchInnerScan()`, `fetchSphygmomanometer()` |
| 2.2.4 | レートリミット対応 | 429応答時のリトライ、401応答時のトークンリフレッシュ |
| 2.2.5 | 日時変換ユーティリティ | 14桁/12桁形式 ↔ ISO8601 変換 |

#### 2.3 同期処理実装

| # | タスク | 詳細 |
|---|--------|------|
| 2.3.1 | `sync-body-composition.ts` | 体組成データ取得・保存 |
| 2.3.2 | `sync-blood-pressure.ts` | 血圧データ取得・保存 |
| 2.3.3 | `orchestrator.ts` | 並列実行、エラーハンドリング |
| 2.3.4 | 期間分割処理 | 3ヶ月制限対応のチャンク処理 |

#### 2.4 CLI 実装

| # | タスク | 詳細 |
|---|--------|------|
| 2.4.1 | `cli.ts` | `--days`, `--log-level` オプション |
| 2.4.2 | package.json スクリプト追加 | `npm run sync:tanita` |

---

### Phase 3: Staging ビュー作成

**目的:** raw テーブルから staging ビューを作成

| # | タスク | 詳細 |
|---|--------|------|
| 3.1 | `stg_tanita_health_planet__body_composition` | JSONB から各カラムを抽出 |
| 3.2 | `stg_tanita_health_planet__blood_pressure` | JSONB から各カラムを抽出 |
| 3.3 | dbt モデル作成 | packages/transform に追加 |

**Staging ビューSQL:**

```sql
CREATE VIEW staging.stg_tanita_health_planet__body_composition AS
SELECT
    id,
    source_id,
    source_id::timestamptz AS measured_at,
    (data->>'weight')::numeric AS weight,
    (data->>'body_fat_percent')::numeric AS body_fat_percent,
    data->>'model' AS model,
    synced_at
FROM raw.tanita_health_planet__body_composition;

CREATE VIEW staging.stg_tanita_health_planet__blood_pressure AS
SELECT
    id,
    source_id,
    source_id::timestamptz AS measured_at,
    (data->>'systolic')::integer AS systolic,
    (data->>'diastolic')::integer AS diastolic,
    (data->>'pulse')::integer AS pulse,
    data->>'model' AS model,
    synced_at
FROM raw.tanita_health_planet__blood_pressure;
```

---

### Phase 4: テスト・検証

| # | タスク | 詳細 |
|---|--------|------|
| 4.1 | ユニットテスト | API クライアント、日時変換のテスト |
| 4.2 | 統合テスト | 実際の API を使った同期テスト |
| 4.3 | データ整合性確認 | 移行データと新規取得データの比較 |
| 4.4 | staging ビュー検証 | 既存クエリとの互換性確認 |

---

## 検証チェックリスト

### Phase 1 完了時

- [ ] 新テーブルが正常に作成されている
- [ ] 既存データが新テーブルに移行されている
- [ ] レコード数が一致している
- [ ] 旧テーブルが削除されている

### Phase 2 完了時

- [ ] `npm run sync:tanita` が正常に実行できる
- [ ] 体組成・血圧データが正しく取得・保存される
- [ ] トークンリフレッシュが自動で行われる
- [ ] エラー時のリトライが正しく動作する

### Phase 3 完了時

- [ ] staging ビューから正しいデータが取得できる
- [ ] dbt モデルが正常にビルドできる

### Phase 4 完了時

- [ ] 全テストがパスしている
- [ ] 本番環境で正常に動作している

---

## 依存関係

```
Phase 1 (DB マイグレーション)
    ↓
Phase 2 (TypeScript コネクタ)
    ↓
Phase 3 (Staging ビュー)
    ↓
Phase 4 (テスト・検証)
```

---

## 関連ドキュメント

- [Tanita Health Planet コネクタ設計](/01-product/100-development/130-design/connector-tanita-health-planet)
- [Tanita Health Planet 仕様](/01-product/100-development/120-specifications/122-pipelines/services/tanita-health-planet)
- [モノレポ移行計画](/02-project/300-management/310-planning/migration-plan) - Phase 8: connector の TypeScript 移行
