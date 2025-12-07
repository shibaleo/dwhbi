---
title: 品質基準・メトリクス
description: コード品質と成果物の品質基準
---

# 品質基準・メトリクス

## 方針

コード品質は静的解析（Ruff, ESLint）とテストカバレッジで計測する。Python は Ruff による lint/format、TypeScript は ESLint + Prettier を必須とする。カバレッジ目標は単体テスト 80%、結合テスト 60%。データ品質は dbt test で保証し、not_null・unique・relationships の 100% パスを必須とする。PR マージ条件として CI 全パスを要求する。
