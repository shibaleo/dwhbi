---
title: Designative Liability Registry
description: プロジェクト固有の意味指示と責任の一覧
---

# Designative Liability Registry

## Designative Liabilityとは

**Designative Liability（指示責任）** とは、記号に対して特定の解釈を指示し、その指示に従って行動するルールを設定することで生じる責任である。指示者自身も、指示を受ける者も、そのルールに拘束される。

### Semantic Bindingとの関係

| 概念 | 定義 |
|------|------|
| **Designative Liability** | 意味を指示し、そのルールの妥当性・一貫性に責任を負う |
| **Semantic Binding** | 指示されたルールに従う義務 |

Designative Liabilityを負う者は、自らもSemantic Bindingを受ける。

```
┌─────────────────────────────────────────┐
│         Semantic Binding               │
│      （意味による拘束を受ける）           │
│                                         │
│    ┌───────────────────────────────┐   │
│    │  Designative Liability       │   │
│    │  （指示責任を負う）            │   │
│    └───────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### サービス選択における責任の配分

| サービス類型 | Designative Liability | ユーザーの状態 |
|-------------|----------------------|---------------|
| 特化型サービス（Toggl, Fitbit） | サービス提供者が負う | Semantic Bindingのみ（従うだけ） |
| 汎用ツール（Notion） | ユーザー自身が負う | 指示＋拘束の両方（認知負荷高） |
| **LIFETRACER統合レイヤー** | **自分が負う** | **ここでのみ指示責任を引き受ける** |

### なぜ管理が必要か

Designative Liabilityが発生する設計は：

- **プロジェクト固有のルール**になる（サービス提供者の仕様ではない）
- **変更すると影響範囲が大きい**（技術的負債になりうる）
- **非合理的な指示は将来のコストになる**

そのため、どこでDesignative Liabilityを負っているかを明示的に管理する。

---

## Registry

### DL-001: Calendar descriptionにクライアント名を記述

**指示内容：**
Google Calendarイベントのdescriptionフィールドの1行目に、Togglのクライアント名を記述する。

**例：**
```
WORK
A社向け提案書作成の打ち合わせ
```

**影響範囲：**
- Calendarイベント入力時のルール
- `ref.map_gcalendar_categories` テーブル
- core層の `fct_time_planned` モデル

**根拠：**
summaryは自由記述として残し、カテゴリ情報はdescriptionで構造化する。2行目以降は自由記述として使える。

---

### DL-002: client → time_category の用語統一

**指示内容：**
Togglの「client」という用語を、システム内では「time_category」と呼ぶ。

**例：**
```sql
-- Toggl APIでは「client」
raw.toggl_clients

-- システム内では「time_category」
ref.mst_time_categories
```

**影響範囲：**
- refスキーマのテーブル名
- core/marts層のモデル名
- ドキュメント全般

**根拠：**
「client」はToggl固有の用語。将来的にToggl以外のサービスに移行する可能性、および支出カテゴリ（expense_category）との区別のため、ドメイン固有の用語に統一する。

---

### DL-003: Toggl色とCalendar色のマッピング

**指示内容：**
Togglのプロジェクト色とGoogle Calendarのイベント色を以下のように対応付ける。

| Toggl色 | Toggl色名 | GCal色 | GCal色名 |
|---------|----------|--------|----------|
| `#0b83d9` | Blue | `#039be5` | Peacock |
| `#2da608` | Green | `#0b8043` | Basil |
| `#06a893` | Teal | `#33b679` | Sage |
| `#c9806b` | Peach | `#e67c73` | Flamingo |
| `#465bb3` | Indigo | `#3f51b5` | Blueberry |
| `#990099` | Magenta | `#8e24aa` | Grape |
| `#566614` | Olive | `#7986cb` | Lavender |
| `#525266` | Gray | `#616161` | Graphite |
| `#e36a00` | Orange | `#f4511e` | Tangerine |
| `#c7af14` | Yellow | `#f6bf26` | Banana |
| `#d92b2b` | Red | `#d50000` | Tomato |

**影響範囲：**
- `ref.mst_time_qualities` テーブル
- Calendarイベント作成時の色選択
- 予実比較分析

**根拠：**
両サービスの色パレットは異なるが、視覚的に近い色をマッピングすることで、予定（Calendar）と実績（Toggl）の色による直感的な対応を可能にする。

---

### DL-004: 色に「時間の質」の意味を付与

**指示内容：**
Toggl/Calendarの色に以下の意味を付与する。

| 色 | 時間の質 | 説明 |
|----|---------|------|
| Blue/Peacock | 管理 | 自己管理、振り返り |
| Green/Basil | 勉強 | 学習、スキルアップ |
| Teal/Sage | 用事 | 雑務、手続き |
| Peach/Flamingo | 必須 | 生理的必需（食事、衛生） |
| Indigo/Blueberry | 仕事 | 業務、労働 |
| Magenta/Grape | 余暇 | 娯楽、リラックス |
| Olive/Lavender | 漂流 | 無意識的な時間消費 |
| Gray/Graphite | 未使用 | 予備 |
| Orange/Tangerine | 睡眠 | 睡眠 |
| Yellow/Banana | 運動 | 身体活動 |
| Red/Tomato | 学問 | 学術的探求 |

**影響範囲：**
- `ref.mst_time_qualities` テーブル
- 全ての時間分析
- Grafanaダッシュボード

**根拠：**
時間の使い方を「何をしたか」（プロジェクト）だけでなく「どんな質の時間か」という軸で分析するため。この分類は過去の議論（意識性、選択可能性など）を経て決定された。

---

## 新規追加時のガイドライン

### いつDLを登録するか

以下に該当する設計決定はDLとして登録する：

1. **サービス提供者の仕様ではない**独自ルールを定義する
2. **複数のサービスを橋渡しする**マッピングを定義する
3. **用語を統一・再定義する**
4. **データに意味を付与する**（色、コード、フラグなど）

### 登録フォーマット

```markdown
### DL-XXX: [タイトル]

**指示内容：**
何を指示するか。

**例：**
具体例。

**影響範囲：**
- 影響するテーブル、モデル、ドキュメント

**根拠：**
なぜこの指示をするか。
```

### コード/SQLでの参照

```sql
-- [DL-003] Toggl色とCalendar色のマッピング
CREATE TABLE ref.mst_time_qualities (
  ...
);
```

```python
# [DL-001] Calendar descriptionの1行目からカテゴリを抽出
def extract_category(description: str) -> str:
    ...
```

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2025-12-05 | 初版作成。DL-001〜DL-004を登録 |
