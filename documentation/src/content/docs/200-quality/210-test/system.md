---
title: システムテスト計画
description: データフロー全体の検証方針（Level 3）
---

# システムテスト計画（Level 3）

## 方針

本番相当の環境で、データフロー全体が正しく動作することを検証する。QPI モデルを適用し、Information × DWH層 の組み合わせで網羅的にテストする。main マージ時に CI で自動実行する。

## Information × DWH層 のフロー検証

| Information | フロー | 検証内容 |
|------------|--------|----------|
| actual | connector → Raw → Staging → Core → Marts | 欠損なく変換されるか |
| estimate | analyzer → Raw → Core → Marts | 予測値が正しく伝播するか |
| intent | console → Raw → Core → Marts | 意向値が正しく伝播するか |
| target | adjuster → Raw → Core → Marts | 調整値が正しく伝播するか |

## ドメイン横断の整合性

| テスト | 検証内容 |
|--------|----------|
| time × finance | 時間と支出の整合性（同一日のデータ存在） |
| time × health | 活動と健康データの整合性 |

## 検証項目

| 項目 | 検証内容 |
|------|----------|
| 同期完了 | 8サービスすべてが正常に同期完了 |
| データ変換 | Staging/Core/Marts 層のデータが正しく生成 |
| 予測出力 | estimate が正しく計算される |
| 調整出力 | target が正しく計算される |
| UI表示 | console で同期状況・設定が正しく表示 |

## 特徴

- 本番相当のデータ量
- 全モジュール稼働
- main マージ時に実行

## 関連

- [テスト戦略](./) - 全体方針
