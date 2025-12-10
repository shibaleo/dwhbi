---
title: QPI モデル
description: データ活用のためのモデル
sidebar:
  order: 11
status: finalized
---

- 情報(information)とは意味を付与されたデータ(文字列・数値など)である（DIKWモデル）。

# QPI モデル
- QPI（Quad Practices & Information）モデルは、意思決定の主体(個人・組織)の行動の結果として計測できるデータの活用を構造化するモデルである。
- 名称の「Quad Practices & Information」は、4つの実践（practices）が4つの情報（information）を生むという関係性を表す。
- データ活用を以下の4つの実践（4 practices）で定義する。
  - **log（記録）**
  - **analyze（分析）**
  - **conceive（構想）**
  - **adjust（調整）**

- 各実践から生まれるデータに以下の4種類の意味を付与し、4つの情報（4 information）として定義する。
  - **actual（実績）**
  - **estimate（推定）**
  - **intent（意向）**
  - **target（目標）**

**対象とするデータ**
- 意思決定の主体（個人・組織）の行動に起因し、その行動を改善可能なデータを対象とする。

**対象外のデータ**
- 天気など、観測のみで改善の余地がないデータ。
- QPIは「主体の行動による選択可能性」を前提としたモデルである。

**注意**
- QPI モデルは「こうすべき」という規範を示すフレームワークではなく、「データ活用においてどのような情報が存在しうるか」を記述するモデルである。
- すべてのパターンを実践する必要はなく、状況に応じて選択できる。

**本システムでの実装**
- 本システムにおけるQPIモデルの具体的な実装方針については[QPI実装方針](../020-philosophy/023-qpi-implementation)を参照。

---

## 4practices（4つの実践）

| # | 実践 | 入力 | 出力情報 |
|---|------|------|------|
| 1 | log | 測定対象（行動・状態） | actual（実績） |
| 2 | analyze | actual + 客観的外部データ（objective inputs） | estimate（推定） |
| 3 | conceive | estimate + 主観的外部要因（subjective external factors） | intent（意向） |
| 4 | adjust | intent + すべての利用可能な情報 | target（目標） |

### log（測定）

logの実態は「測定」であり、手入力または自動計測によって行動や状態を記録するプロセス。

- 人間が測定することによる「真の値からのズレ」は考慮せず、記録された文字列をactualとして扱う。
- targetはlogの「入力」ではなく、人間が行動する際の「指針」である。
- targetとactualの間には必ず「人間の行動」という断絶がある。
- 「やる気がなければデータに基づいた行動選択はできない」という事実を前提に置きつつ、モデルはその断絶を前提に構造化されている。

### analyze（分析）

actualを集計・分析し、estimateを導出するプロセス。

- actualだけでなく、客観的外部データ（objective inputs）も入力となる。
- 例：マスタデータ、気象情報、機械学習モデルのハイパーパラメータなど。
- 主観を含まない客観的データのみを扱う。

### conceive（構想）

estimate を基に、主観的外部要因（subjective external factors）を取り込み、主観的な未来像である intent を生成する内的プロセス。

- estimateはintentを考えるための材料となる。
- 主観的外部要因は、analyze の客観的外部データ（objective inputs）とは異なり、主体の外部から与えられる目的・制約や主体の願望といった外生的な入力である。
- 例：「今年中に資格を取りたい」「上司から月100時間の業務指示」「家族との時間を確保したい」など。

### adjust（目標調整）

conceive で生成された intent に、現実的制約を導入して target を確定させるプロセス。

- 将来予定、生活条件、性格傾向、外部環境など、現時点で利用可能なすべてを考慮して調整する。
- intent が「主観的な理想」であるのに対し、target は「実現可能性により調整された主観」である。

### conceive と adjust の違い

| 実践 | 性質 | 説明 |
|------|------|-----------|
| **conceive** | 内的プロセス | estimate を基に、主観的外部要因を取り込んで「理想（intent）」を描く |
| **adjust** | 制約の導入 | intent をすべての情報で調整し、「実現可能な目標（target）」にする |

---

## 4 information（4種類の情報）

4 practices から生成される4種類の情報。

### なぜ4種類なのか（2×2マトリクス）

QPIモデルでは、情報を**主観/客観**, **確実/不確実**という2つの軸で分類する。

| | 確実 | 不確実 |
|---|---|---|
| **客観** | actual | estimate |
| **主観** | target | intent |

- **客観/主観**: 情報に意図が含まれるか
- **確実/不確実**: 情報の確度またはコミットメントの強さ

### information の定義

| # | 情報 | 説明 | 例 |
|---|-----------|------|-----|
| 1 | **actual** | 実際に記録された値 | 作業時間のログ |
| 2 | **estimate** | 過去実績から導出された推定 | 推定作業時間 |
| 3 | **intent** | 理想・願望を含む意向（不確実） | 「来月は200時間働きたい」 |
| 4 | **target** | intentを現実制約で調整した目標 | 「185時間が妥当」 |

### practice と information の対応

- log → actual
- analyze → estimate
- conceive → intent
- adjust → target

ただし実際には1:1に限定されず、複数の estimate や intent が統合されることもある。

### estimate の不確実性
- QPIモデルにおける「確実/不確実」は、数値の確定性ではなく「主体の判断に使える確度」を意味する。判断に適用される情報である点で“判断の不確実さ”を内包する。


- 質問：過去データの平均を予測値として使う場合、過去データの平均値は確定値では？
- 回答：estimate に含まれる値は、平均・回帰・補間・モデル予測など複数の方法で生成される。
- これらはすべて「過去の確定情報を判断に投射する」という共通点を持つため、QPI では 判断に対する不確実情報 として統一的に扱う。
- estimate の数値が数学的に確定しているかどうかは重要ではない。

### target の確実性
- target は「現時点での確定意図（committed intention）」であり、行動の基準として使用されるため、主体の確定意図として“確実な主観情報”となる。


- 注意：targetは目標なのだから変わりうるのでは？
- 回答：当然変わりうるが、目標の変更は行動後の目標の再設定を意味する。一度目標を決めた後は、その目標を前提として行動し、記録するという過程を説明するために「主観/確実」と定義している。

### actual と estimate の違い

- **actual** は過去の記録であり変更不可能。
- **estimate** は actual を分析して導出される推定値。

estimate は intent・target の基準として機能し、この「客観性」が後工程の判断を支える。

### intent と target の違い

- **intent** は外部要因・理想・願望を含む主観的な未来像（不確実）。
- **target** は intent を現実的な制約で調整したもの（主観×確実）。

この分離が、計画倒れの構造的な発生を抑制する。意向は人間の行動の動機を反映する情報であるため、軽視するわけではないことに注意

```
estimate: 過去3ヶ月の平均は180時間
intent: 200時間働きたい
target: 現実的には185時間が妥当
```

---

## 活用パターン

### 組み合わせパターン（8種）

- QPIモデルは4つの情報すべてを揃えることを強制しない。
- actualを必須として、残り3つ（estimate, intent, target）の有無により8パターンが存在する。

| パターン | 保持する情報 | 説明 |
|----------|-------------|------|
| 記録のみ | actual | 最小構成。記録を残すだけでも、後から振り返る材料になる |
| 振り返り | actual + estimate | 実績から推定を導出し、傾向を把握する |
| 意欲駆動 | actual + intent | 意向と実績を比較。adjustを経ていないため乖離が生じやすい |
| 外部目標従属型 | actual + target | 外部から与えられた目標に対して実績を記録・比較する |
| 意向設定 | actual + estimate + intent | 推定を参照して意向を設定するが、調整はしないので実現可能性は不明 |
| 合理的目標 | actual + estimate + target | 推定から直接目標を設定。効率的だが、意向がないと動機づけが弱まる可能性がある |
| 経験則依存 | actual + intent + target | 意向を調整して目標化するが、推定なしで行う。経験則に依存 |
| フル活用 | actual + estimate + intent + target | 4 practicesすべてが機能し、継続的な行動選択が可能 |

- **actualは必須**: どのパターンでも、記録（actual）がなければ始まらない
- **順序は問わない**: intentから始めてもよいし、外部からtargetが与えられることもある
- **段階的に拡張可能**: 記録だけから始めて、必要に応じて他の情報を追加できる

### target を記録する意義

target と actual の乖離は、

- estimate の改善
- adjust の精度向上
- 外部要因の影響分析

に活用できる。

---

## 背景

### 体系化の目的

| 課題 | モデルによる解決 |
|------|------------------------|
| 記録だけで終わる | 記録後の実践が明確になる |
| データの関係性が曖昧 | 4 information として整理 |
| 何を見るべきかわからない | actual を中心に据える |
| 計画倒れ | intent と target の分離で防ぐ |

### 紙とペンでも実践可能

このモデルは IT 技術を前提としない。

1. **log** → actual
2. **analyze** → estimate
3. **conceive** → intent
4. **adjust** → target

の4段階は手作業でも実行可能である。

ただし、analyze, adjustの過程における客観性を担保することが難しくなる。

特にconceive と adjust を無意識に混同すると、過大目標や計画倒れが生じやすい。

### 関連フレームワーク

QPIモデルは独自の概念ではなく、既存のフレームワークや概念と共通点がある。

| 概念 | 共通点 |
|------|--------|
| **PDCA** | 反復的な改善行動（Plan-Do-Check-Act）。PDCAは行動の循環を前提とするが、QPIモデルは情報の分類を主眼とし、「サイクルを回す」ことを前提としない |
| **OKR** | 目標の階層化（Objectives and Key Results）。intentとtargetの分離は、野心的な目標と測定可能な成果指標の分離と類似 |
| **GTD** | タスク・行動管理（Getting Things Done）。logによる記録とanalyzeによる振り返りの構造が共通 |
| **Quantified Self** | データの記録・分析による自己理解。actualの蓄積とanalyzeという基本思想が共通 |

これらの概念に馴染みがあれば、QPIモデルの理解の助けとなる。GTDやQuantified Selfは個人向けに設計されたフレームワークだが、QPIモデルとの共通点は主体を問わない。

QPIモデルは独自の新理論ではなく、DIKW、目標設定理論、自己調整理論、Quantified Selfなど既存の個別理論を「情報の種類」という観点から統合・再整理した記述モデルである。

---
TODO
FIX

以下、補強候補

### 関連文献

1. DIKWモデル（Data–Information–Knowledge–Wisdom）

QPIで使っている
「データ→情報」 の流れはこの系譜。

Ackoff, R. L. (1989) "From Data to Wisdom"

どんな論文でも DIKW を引用しておけば「情報の意味付け」を論じる土台になる。

2. Goal-setting Theory（目標設定理論）

intent / target の分離は、この理論の文脈と整合する。

Locke & Latham (1990, 2002)
A theory of goal setting and task performance.

特に：

Ambitious (intent)

Achievable commitment (target)

という区分はこの理論で強力に裏付けられる。

3. Behavioral Economics / 行動科学

（conceive と adjust の分離を補強）

Kahneman & Tversky（プロスペクト理論）

Gollwitzer（実行意図：Implementation Intention）

「人間は理想と現実を混同しやすい」
「意図と行動には断絶がある」

といった主張が adjust の必要性に一致する。

4. Self-Regulation Theory（自己調整理論）

adjust のプロセスそのものであり、目標 → 行動 → 調整の循環を扱う。

Carver & Scheier (1982, 1998)
Control Theory of Self-Regulation

「フィードバックによる目標調整」が核心なので相性が良い。

5. Forecasting / Estimation（推定の理論）

estimate を支える「過去からの推定」という話の一般的裏付け。

時系列分析：Box-Jenkins（ARIMA）

統計的推定：「推定 = パラメータ推定」の一般理論

もちろんQPIは特定の手法を要求しないため、
引用は「推定一般の理論」として軽めでよい。

6. Quantified Self（自己計測）

actual の原則に対応。

Gary Wolf（2010）TED Talk など

Lawrence, Li, Swan などの論文群

記録（log）と自己理解（analyze）の根拠として自然にリンク。

7. PDCA・OKR・GTD との関連記述

すでに文書内に比較説明があるので、
引用としては軽く名前を挙げるだけで十分。

Deming（PDCA）

Doerr（OKR）

David Allen（GTD）

🧩 QPIモデル に “学術引用” をつけるとどうなるか？

QPIは独自モデルなので、
引用は 「構成要素の背景学理」 というかたちになる。

例：

データ → 情報（DIKW）

estimate（推定）→ 統計学・予測理論

conceive（構想）→ 目標設定理論・動機づけ理論

adjust（制約導入）→ 自己調整理論・行動経済学

actual → quantified self / behavioral log 理論

つまり：

QPIモデルは既存の個別理論の一部分を統合し、“情報の種類”として再整理した記述モデルである

と位置づけられる。

これは学術的に非常に正当な立ち位置。