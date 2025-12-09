---
title: 結合テスト計画
description: コンポーネント間連携のテスト方針（Level 2）
---

# 結合テスト計画（Level 2）

## 方針

複数のコンポーネントを組み合わせた動作を検証する。テスト用の Supabase プロジェクト（またはローカル Docker）を使用し、実際のスキーマに対してデータの流れを確認する。GitHub Actions の workflow で PR ごとに実行する。

## Level 2a: Component Integration（モジュール内結合）

モジュール内の複数コンポーネントの連携。

| モジュール | テスト対象 |
|-----------|-----------|
| connector | API取得 → 変換 → DB保存 の一連の流れ |
| analyzer | データ取得 → 予測 → 結果保存 の一連の流れ |
| adjuster | 予測結果取得 → 調整計算 → アクション保存 の一連の流れ |
| console | UI入力 → バリデーション → DB保存 |
| reporter | データ取得 → テンプレート適用 → PDF生成 |
| transform | Raw → Staging → Core → Marts の変換チェーン |

## Level 2b: System Integration（モジュール間結合）

隣接モジュール間のデータ受け渡し。

| 連携 | テスト内容 |
|------|-----------|
| connector → transform | actual が Raw に保存され、Staging で読めるか |
| analyzer → transform | estimate が Raw に保存され、変換されるか |
| adjuster → transform | target が Raw に保存され、変換されるか |
| console → transform | intent が Raw に保存され、変換されるか |
| transform → reporter | Marts のデータで PDF が生成できるか |
| transform → console | Marts のデータが管理画面で表示できるか |
| transform → analyzer | Core のデータで予測が実行できるか |
| analyzer → adjuster | estimate を入力に調整計算が実行できるか |

## 特徴

- 実際の DB を使用
- スキーマ契約の検証
- PR ごと（L2b は affected のみ）

## 関連

- [テスト戦略](./) - 全体方針
