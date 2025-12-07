---
title: 単体テスト計画
description: 関数・モジュール単位のテスト方針
---

# 単体テスト計画

## 方針

各プロジェクト（pipelines, transform, analyzer, console）において、関数・モジュール単位の動作を検証する。外部依存（API、DB）はモック化し、ロジックの正確性に集中する。pytest（Python）と Jest/Vitest（TypeScript）を使用し、カバレッジ80%以上を目標とする。CI（GitHub Actions）で PR ごとに自動実行する。

## 対象

| プロジェクト | テストフレームワーク | 主な対象 |
|-------------|---------------------|----------|
| pipelines | pytest | API クライアント、データ変換関数 |
| transform | dbt test | SQL モデルのスキーマ・データ品質 |
| analyzer | pytest | 特徴量生成、予測ロジック |
| console | Vitest | ユーティリティ関数、フック |
