---
title: Analyzer 概要
description: ML分析モジュールの設計と構成
---

# Analyzer 概要

## 目的

analyzerは、DWHに蓄積されたデータを機械学習で分析し、推定値（estimate）や予測を生成するモジュール。

## 位置づけ

```
pipelines (Extract/Load)
    ↓
transform (dbt: staging → core → marts)
    ↓
analyzer (ML: estimate生成、予測)
    ↓
marts (分析結果の可視化)
```

## 主な機能（予定）

| 機能 | 説明 | 入力 | 出力 |
|------|------|------|------|
| 時間推定 | カテゴリ別の作業時間推定 | actual (実績) | estimate |
| day_type判定 | 日タイプの自動分類 | actual + plan | day_type |
| 異常検知 | 通常パターンからの逸脱検出 | actual | アラート |

## プロジェクト構成

[131 ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure)に基づく構成：

```
analyzer/
├── pyproject.toml       # Python依存（LightGBM, scikit-learn等）
├── .python-version
├── .venv/
├── src/analyzer/        # MLロジック
├── transform/           # analyzer用dbt（中間テーブル）
├── notebooks/           # 探索的分析
└── tests/
```

### analyzer内にtransform/を持つ理由

- analyzerスキーマ用の中間テーブル・ビューはanalyzerの責務
- メインのtransform/はstaging/core/martsを担当
- 関心の分離を維持

## 関連

- [131 ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure)
- [011 QPIモデル](/000-foundations/010-theory/011-qpi-model) - estimate情報の位置づけ
