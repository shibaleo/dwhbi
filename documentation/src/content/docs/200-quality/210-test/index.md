---
title: テスト戦略
description: 4レベルテストピラミッドによる品質保証方針
---

# テスト戦略

## 概要

本プロジェクトでは、4レベルのテストピラミッドを採用し、各レベルで異なる粒度・目的のテストを実施する。

```
         ▲
        /L4\        Acceptance（受け入れ）
       /────\       ユーザー要件の充足確認
      / L3   \      System（システム）
     /────────\     データフロー全体の検証
    /   L2     \    Integration（結合）
   /────────────\   モジュール内・モジュール間連携
  /     L1       \  Unit（単体）
 /────────────────\ 関数・クラス単位のテスト
```

## Level 1: Unit Testing（単体テスト）

各モジュール内の関数・クラス単位のテスト。

| モジュール | テスト対象 |
|-----------|-----------|
| connector | API クライアント、データ変換関数、バリデーション |
| analyzer | 予測モデル、特徴量生成 |
| adjuster | 調整ロジック、介入提案アルゴリズム |
| console | フォームバリデーション、状態管理 |
| reporter | テンプレート処理、データ整形 |
| transform | dbt モデルの単体テスト（dbt test） |

**特徴:**
- 外部依存をモック化
- 高速実行
- 開発中に頻繁に実行

## Level 2: Integration Testing（結合テスト）

### 2a: Component Integration（モジュール内結合）

モジュール内の複数コンポーネントの連携。

| モジュール | テスト対象 |
|-----------|-----------|
| connector | API取得 → 変換 → DB保存 の一連の流れ |
| analyzer | データ取得 → 予測 → 結果保存 の一連の流れ |
| adjuster | 予測結果取得 → 調整計算 → アクション保存 の一連の流れ |
| console | UI入力 → バリデーション → DB保存 |
| reporter | データ取得 → テンプレート適用 → PDF生成 |
| transform | Raw → Staging → Core → Marts の変換チェーン |

### 2b: System Integration（モジュール間結合）

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

**特徴:**
- 実際の DB を使用
- スキーマ契約の検証

## Level 3: System Testing（システムテスト）

データフロー全体の検証。QPI モデルを適用。

### Information × DWH層 のフロー検証

| Information | フロー | 検証内容 |
|------------|--------|----------|
| actual | connector → Raw → Staging → Core → Marts | 欠損なく変換されるか |
| estimate | analyzer → Raw → Core → Marts | 予測値が正しく伝播するか |
| intent | console → Raw → Core → Marts | 意向値が正しく伝播するか |
| target | adjuster → Raw → Core → Marts | 調整値が正しく伝播するか |

### ドメイン横断の整合性

| テスト | 検証内容 |
|--------|----------|
| time × finance | 時間と支出の整合性（同一日のデータ存在） |
| time × health | 活動と健康データの整合性 |

**特徴:**
- 本番相当のデータ量
- 全モジュール稼働

## Level 4: Acceptance Testing（受け入れテスト）

ユーザー要件の充足確認。

| 要件 | テスト内容 |
|------|-----------|
| 日次同期 | 毎日 00:00 JST にデータが更新されるか |
| 日次レポート | PDF が正しく生成され、Google Drive に保存されるか |
| ダッシュボード | Grafana で最新データが表示されるか |
| 管理画面 | intent の入力・保存が正常に動作するか |
| 予測精度 | estimate と actual の乖離が許容範囲内か |
| 調整効果 | target 適用後の改善が確認できるか |

**特徴:**
- 本番環境
- 実ユーザー視点

## テスト配置

```
supabase-sync-jobs/
├── apps/
│   ├── connector/
│   │   └── __tests__/        # L1, L2a
│   ├── console/
│   │   └── __tests__/        # L1, L2a
│   └── reporter/
│       └── __tests__/        # L1, L2a
├── tools/
│   ├── transform/
│   │   └── tests/            # L1 (dbt test)
│   ├── analyzer/
│   │   └── tests/            # L1, L2a
│   └── adjuster/
│       └── tests/            # L1, L2a
└── tests/
    ├── integration/          # L2b (モジュール間)
    ├── system/               # L3 (データフロー全体)
    └── acceptance/           # L4 (要件充足)
```

## 実行タイミング

| レベル | タイミング | CI 実行 |
|--------|-----------|---------|
| L1 Unit | 開発中常時 | PR ごと |
| L2a Component Integration | 機能完成時 | PR ごと |
| L2b System Integration | モジュール変更時 | PR ごと（affected） |
| L3 System | リリース前 | main マージ時 |
| L4 Acceptance | リリース前 | 手動 or 定期 |

## テストフレームワーク

| プロジェクト | フレームワーク | カバレッジ目標 |
|-------------|---------------|---------------|
| connector | Jest/Vitest | 80% |
| console | Vitest | 80% |
| reporter | Vitest | 80% |
| analyzer | pytest | 80% |
| adjuster | pytest | 80% |
| transform | dbt test | - |

## 関連ドキュメント

- [単体テスト計画](./unit) - Level 1 の詳細
- [結合テスト計画](./integration) - Level 2 の詳細
- [システムテスト計画](./system) - Level 3 の詳細
- [E2Eテスト計画](./e2e) - Level 4 の詳細
- [ADR-005 モノレポ構成](/100-development/130-design/131-decisions/adr_005-monorepo-structure) - プロジェクト構成
