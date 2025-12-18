# スケジュールパターン管理

## 概要

24時間を埋めるタイプのスケジュール管理において、パターン管理とスケジュール管理の責務を分離し、Google Calendarを唯一の真実（Single Source of Truth）として運用する設計。

## 背景・課題

### 現状の問題

- Google Calendarで平日/休日パターンを繰り返し設定すると、実体イベントが膨大に蓄積（1日20件 × 365日 = 年間7000件以上）
- 同一種類のエントリーの一括操作ができない
- プロジェクトで分類できない
- Google Calendar APIのクォータ制限（1日あたりのリクエスト上限）に抵触

### 本質的な情報量

- 平日パターン：1つ
- 休日パターン：1つ
- 例外：特定日の上書きのみ

にもかかわらず、1年分のイベント実体が存在している非効率な状態。

## 設計方針

### 責務分離

| 責務 | 担当 | 内容 |
|------|------|------|
| パターン定義 | Coda | 平日/休日の時間割テンプレート |
| パターン変遷 | DB | いつ、どう変わったかの履歴（バージョン管理） |
| Committed Target | Google Calendar | 各日の最終的な計画（唯一の真実） |
| 例外 | Google Calendar | 特定日の上書き |
| 集計・分析 | DB | Google Calendarから同期して計算 |

### Google Calendarの意味づけ

Google Calendarは「予定」ではなく **Committed Target（確約された目標）** として位置づける。

- 各日ごとに最終的に意図された唯一の計画
- 実績（Toggl Track）と比較する対象

## データフロー

```
[Coda]
└── パターンマスタ（平日/休日の時間割）
        │
        │ 同期スクリプト
        ↓
[DB (Supabase)]
├── raw.coda__time_patterns（Codaから同期）
├── pattern_versions（変更履歴）※派生
└── calendar_events（分析用）
        │
        │ 同期スクリプト
        ↓
[Google Calendar]
├── 繰り返しシリーズ（パターンから生成）
└── 例外イベント（直接編集）
        │
        │ 既存連携
        ↓
[Toggl Track]
└── 予実比較ビュー
```

## 運用フロー

### 日常運用

| 操作 | 場所 | 頻度 |
|------|------|------|
| パターン編集 | Coda | たまに |
| 例外登録 | Google Calendar | 随時 |
| 分析・シミュレーション | DB（Grafana） | 随時 |

### パターン変更時

1. Codaでパターンマスタを編集
2. 同期スクリプト実行
3. Google Calendar側で自動的に：
   - 既存シリーズの終了日を設定
   - 新シリーズを作成

## データモデル

### Coda テーブル

- `raw.coda__time_patterns`（詳細未定）

### Google Calendar

- 既存のテーブル構造を継続使用

### DB (Supabase)

パターンの変遷はDBの時系列を分析することで把握。

## 今後の検討事項

- [ ] Codaテーブルの詳細設計（カラム定義）
- [ ] Coda → DB 同期スクリプト実装
- [ ] DB → Google Calendar 同期スクリプト実装
- [ ] パターン変更時のGoogle Calendar操作自動化
- [ ] 「来週の学習時間」等のシミュレーションクエリ設計

## 関連ドキュメント

- [004-autogenerate-plan.md](./004-autogenerate-plan.md)
