---
title: 単体テスト計画
description: 関数・モジュール単位のテスト方針（Level 1）
---

# 単体テスト計画（Level 1）

## 方針

各プロジェクト（connector, transform, analyzer, adjuster, console, reporter）において、関数・モジュール単位の動作を検証する。外部依存（API、DB）はモック化し、ロジックの正確性に集中する。pytest（Python）と Jest/Vitest（TypeScript）を使用し、カバレッジ80%以上を目標とする。CI（GitHub Actions）で PR ごとに自動実行する。

## 対象

| プロジェクト | テストフレームワーク | 主な対象 |
|-------------|---------------------|----------|
| connector | Jest/Vitest | API クライアント、データ変換関数、バリデーション |
| transform | dbt test | SQL モデルのスキーマ・データ品質 |
| analyzer | pytest | 特徴量生成、予測モデル |
| adjuster | pytest | 調整ロジック、介入提案アルゴリズム |
| console | Vitest | フォームバリデーション、状態管理 |
| reporter | Vitest | テンプレート処理、データ整形 |

## 特徴

- 外部依存をモック化
- 高速実行（数秒以内）
- 開発中に頻繁に実行

## 関連

- [テスト戦略](./) - 全体方針
