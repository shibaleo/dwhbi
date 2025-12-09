---
title: スキーマ契約
description: dbt contracts によるスキーマ整合性の管理
---

# スキーマ契約

## 概要

モジュール間のスキーマ整合性を dbt contracts で管理する。

## 型管理の全体像

本プロジェクトでは2つの仕組みでスキーマ整合性を確保する。

| 仕組み | 対象 | 役割 |
|--------|------|------|
| supabase gen types | TypeScript モジュール | DB スキーマから型を生成し、コンパイル時に型エラーを検出 |
| dbt contracts | dbt モデル | 期待するスキーマを定義し、ビルド時に違反を検出 |

### 責務の分離

```
[connector] ─────→ Raw層 ─────→ [dbt] ─────→ Marts層 ─────→ [console/reporter]
     ↑                            ↑                              ↑
supabase gen types           dbt contracts                supabase gen types
```

- **supabase gen types**: TypeScript モジュール（connector, console, reporter）が DB を操作する際の型安全性
- **dbt contracts**: Raw → Staging → Core → Marts の変換過程でのスキーマ整合性

両者は補完関係にあり、TypeScript 側は型で、dbt 側は契約で整合性を守る。

## dbt contracts の目的

- 上流モジュール（connector, analyzer, console）の変更による影響を検出
- 暗黙の依存関係を明示化
- CI での早期エラー検出

## 契約の定義方法

```yaml
models:
  - name: stg_toggl_entries
    config:
      contract:
        enforced: true
    columns:
      - name: id
        data_type: bigint
      - name: start_time
        data_type: timestamp with time zone
      - name: duration_seconds
        data_type: integer
```

## 導入方針

- 全モデルへの一括導入はしない
- 整合性の問題が発生した箇所から契約を追加
- 安定したモデルを優先

## 契約違反時の対応

1. CI でビルドエラーとして検出
2. 原因の特定（上流の変更 or 契約の誤り）
3. 契約の更新、または変換ロジックの修正
