---
title: 結合テスト計画
description: コンポーネント間連携のテスト方針
---

# 結合テスト計画

## 方針

複数のコンポーネントを組み合わせた動作を検証する。pipelines → DB 書き込み → transform の一連のフローや、console → Supabase API の連携をテストする。テスト用の Supabase プロジェクト（またはローカル Docker）を使用し、実際のスキーマに対してデータの流れを確認する。GitHub Actions の workflow で定期実行（daily）する。

## 対象

| 連携パターン | 検証内容 |
|-------------|----------|
| pipelines → raw テーブル | API 取得データが正しく保存されるか |
| raw → staging → core | dbt run 後のデータ整合性 |
| console → Vault | 認証情報の保存・取得 |
| analyzer → core.estimate | 推定値の書き込み |
