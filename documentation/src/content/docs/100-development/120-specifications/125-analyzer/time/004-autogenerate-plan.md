---
title: 004 plan 自動生成ロジック
description: estimate と target から plan を自動生成する仕組み
---

# plan 自動生成ロジック

## 概要

ADR-003 のフィードバックループにおける「adjustment」プラクティスの自動化。
estimate（推定）と target（目標）の差分を埋める plan（計画）をレコード形式で自動生成する。

## 目的

- target 達成に必要なスケジュールを自動提案
- 過去の actual パターンを活かした現実的な時間配置
- Google Calendar への書き戻しによる実行支援

## データ形式の役割分担

| 情報 | 形式 | スキーマ | 管理方法 |
|------|------|----------|----------|
| actual | レコード | `core` | Toggl Track から自動同期 |
| estimate | JSONB集計 | `core` | Python (analyzer) で自動計算 |
| target | 集計 | `console` | **管理画面 GUI で CRUD（SCD Type 2）** |
| plan | レコード | `core` | Google Calendar へ書き戻し |

### スキーマ構成

```
raw       ← 外部 API 生データ（自動同期）
staging   ← クリーニング済み（dbt ビュー）
core      ← 最終出力（actual, estimate, plan）
console   ← ユーザー操作データ（target: SCD Type 2）
analyzer  ← 分析過程の中間テーブル・ビュー
seeds     ← マスタデータ（CSV）
marts     ← 分析・可視化用（将来）
```

### プロジェクト構成

| プロジェクト | 役割 | 技術 | 出力スキーマ |
|-------------|------|------|-------------|
| `pipelines/` | Extract/Load（データ取得） | Python + API | raw |
| `transform/` | Transform（データ変換） | dbt | staging, core, marts |
| `analyzer/` | ML分析 | Python + LightGBM + dbt | analyzer → core |

## 処理フロー

```
actual（過去パターン）
    ↓ 分析（時間帯パターン抽出）
estimate（日次集計）─────┐
                        ├→ plan 生成 → レコード形式
target（日次集計）──────┘
                        ↓
              fct_time_records_plan
                        ↓
              Google Calendar（書き戻し）
```

## 関数インターフェース

### 入力（Input）

| パラメータ | 型 | 説明 |
|------------|-----|------|
| target_date | DATE | plan 生成対象の日付 |
| estimate | dict | カテゴリ別推定時間（分） |
| target | dict | カテゴリ別目標時間（分） |
| actual_patterns | DataFrame | 過去の時間帯パターン |
| constraints | list | 固定イベント（会議、食事等） |

### 出力（Output）

```json
{
  "date": "2025-12-07",
  "plan": [
    {
      "start_at": "2025-12-07T09:00:00",
      "end_at": "2025-12-07T12:00:00",
      "category": "Education",
      "duration_min": 180,
      "confidence": 0.8
    },
    {
      "start_at": "2025-12-07T14:00:00",
      "end_at": "2025-12-07T17:00:00",
      "category": "Education",
      "duration_min": 180,
      "confidence": 0.7
    }
  ],
  "meta": {
    "generated_at": "2025-12-07T08:00:00Z",
    "generation_method": "gap_fill_v1",
    "gap_filled": {"Education": 420}
  }
}
```

| フィールド | 型 | 説明 |
|------------|-----|------|
| date | string | 対象日（YYYY-MM-DD） |
| plan | array | 生成されたスケジュールレコード |
| plan[].start_at | timestamp | 開始時刻 |
| plan[].end_at | timestamp | 終了時刻 |
| plan[].category | string | カテゴリ名 |
| plan[].duration_min | integer | 時間（分） |
| plan[].confidence | float | 配置の確信度（0-1） |
| meta.gap_filled | object | 埋めた差分（カテゴリ別） |

## アルゴリズム（Python 実装）

### v1: Gap Fill（差分充填）

```python
def generate_plan_v1_gap_fill(
    target_date: date,
    estimate: dict,
    target: dict,
    available_slots: list[tuple],  # [(start, end), ...]
    priority_order: list[str] = None
) -> dict:
    """
    estimate と target の差分を空き時間に配置
    """
    # 差分計算（target - estimate で不足分を算出）
    gap = {
        cat: max(0, target.get(cat, 0) - estimate.get(cat, 0))
        for cat in target
        if target.get(cat, 0) > estimate.get(cat, 0)
    }

    # 優先度順にソート（direction='more' のカテゴリを優先）
    if priority_order:
        sorted_cats = sorted(gap.keys(), key=lambda c: priority_order.index(c) if c in priority_order else 999)
    else:
        sorted_cats = sorted(gap.keys(), key=lambda c: -gap[c])

    plan = []
    remaining_slots = list(available_slots)

    for cat in sorted_cats:
        needed_min = gap[cat]
        while needed_min > 0 and remaining_slots:
            slot_start, slot_end = remaining_slots.pop(0)
            slot_duration = (slot_end - slot_start).total_seconds() / 60

            if slot_duration <= needed_min:
                # スロット全体を使用
                plan.append({
                    "start_at": slot_start.isoformat(),
                    "end_at": slot_end.isoformat(),
                    "category": cat,
                    "duration_min": int(slot_duration),
                    "confidence": 0.7
                })
                needed_min -= slot_duration
            else:
                # スロットを分割
                used_end = slot_start + timedelta(minutes=needed_min)
                plan.append({
                    "start_at": slot_start.isoformat(),
                    "end_at": used_end.isoformat(),
                    "category": cat,
                    "duration_min": int(needed_min),
                    "confidence": 0.7
                })
                remaining_slots.insert(0, (used_end, slot_end))
                needed_min = 0

    return {
        "date": target_date.isoformat(),
        "plan": plan,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generation_method": "gap_fill_v1",
            "gap_filled": gap
        }
    }
```

### v2: Pattern-Based（パターン学習）

```python
def generate_plan_v2_pattern_based(
    target_date: date,
    estimate: dict,
    target: dict,
    actual_df: pd.DataFrame,
    day_types_df: pd.DataFrame
) -> dict:
    """
    過去の actual から時間帯パターンを学習して配置
    """
    target_day_type = day_types_df[
        day_types_df['date_day'] == target_date
    ]['day_type'].iloc[0]

    # 同じ day_type の過去データから時間帯パターンを抽出
    same_type = actual_df.merge(day_types_df, on='date_day')
    same_type = same_type[same_type['day_type'] == target_day_type]

    # カテゴリ別の典型的な時間帯を算出
    patterns = {}
    for cat in target.keys():
        cat_data = same_type[same_type['time_category_personal'] == cat]
        if len(cat_data) > 0:
            # 最頻出の開始時間帯を取得
            cat_data['hour'] = pd.to_datetime(cat_data['start_at']).dt.hour
            typical_hour = cat_data['hour'].mode().iloc[0] if len(cat_data['hour'].mode()) > 0 else 9
            patterns[cat] = typical_hour

    # パターンに基づいて配置
    gap = {
        cat: max(0, target.get(cat, 0) - estimate.get(cat, 0))
        for cat in target
    }

    plan = []
    for cat, needed_min in gap.items():
        if needed_min > 0 and cat in patterns:
            start_hour = patterns[cat]
            start_at = datetime.combine(target_date, time(start_hour, 0))
            end_at = start_at + timedelta(minutes=needed_min)

            plan.append({
                "start_at": start_at.isoformat(),
                "end_at": end_at.isoformat(),
                "category": cat,
                "duration_min": int(needed_min),
                "confidence": 0.8  # パターンベースは確信度高め
            })

    return {
        "date": target_date.isoformat(),
        "plan": plan,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generation_method": "pattern_based_v2",
            "patterns_used": patterns
        }
    }
```

## 推奨アプローチ: LLM による plan 生成

plan 生成には **LLM（Claude 等）** を推奨する。

### ML vs LLM の比較

| 観点 | ML（OR-Tools等） | LLM（Claude等） |
|------|------------------|-----------------|
| 制約充足 | 得意（最適解を保証） | 得意（柔軟に解釈） |
| 曖昧な好み | 苦手（明示的ルール化が必要） | 得意（自然言語で指定） |
| 例外処理 | 苦手（想定外の状況） | 得意（常識的な判断） |
| 説明性 | 低（なぜこの配置？） | 高（理由を説明できる） |
| 再現性 | 高（決定論的） | 低（毎回異なる可能性） |
| コスト | 低（ローカル実行） | 高（API 呼び出し） |

### estimate vs plan の手法選択

| 処理 | 推奨手法 | 理由 |
|------|----------|------|
| estimate | ML（Prophet等） | 再現性、バッチ処理、検証可能性 |
| plan 生成 | LLM（Claude等） | 柔軟性、説明性、対話的調整 |

### Claude Desktop + PostgreSQL MCP（推奨）

Max プランユーザーは Claude Desktop + PostgreSQL MCP を活用することで、
API 料金なしで Supabase に直接アクセスしながら対話的に plan 生成が可能。

#### 運用フロー

```
[夜の振り返りセッション]

Claude Desktop（PostgreSQL MCP 経由で Supabase 参照）
    ↓
1. 今日の actual を確認・振り返り
2. 明日の estimate + target を確認
3. 対話的に plan 作成・調整
    ↓
Google Calendar へ登録
```

## Google Calendar 連携

### Google Calendar MCP（推奨）

Claude Desktop に Google Calendar MCP を設定することで、
対話セッション内で直接 Google Calendar にイベントを作成できる。

#### 運用フロー（最終形）

```
[夜の振り返りセッション - Claude Desktop]

1. 最近の傾向を確認
   - 過去7日の actual 平均
   - 目標達成率の推移
   - 「Education が目標の 30% ペース」など

2. 予測値（estimate）を見る
   - ML が計算した明日の予測
   - 「Education は 200分と予測」

3. 目標（target）との差分を確認
   - gap = target - estimate
   - 「400分の差を埋めるのは厳しい」

4. 対話で現実的な計画を立てる
   - 「どのくらいなら達成できそう？」
   - 制約や好みを自然言語で調整
   - 休憩の挿入など細かい調整

5. Google Calendar MCP で登録
   - 確認後にイベント作成
   - 追加・修正もその場で対応

所要時間: 5-10分程度
```

**ポイント**: Claude が「できそうかどうか」を一緒に考えてくれる。
無理な計画を立てずに、現実的な目標設定ができる。

## 実装ステータス

- [ ] v_time_llm_context ビュー
- [ ] v_time_ml_hourly ビュー
- [x] **Claude Desktop + PostgreSQL MCP（推奨）** - 設定済み
- [x] **Claude Desktop + Google Calendar MCP（推奨）** - 設定済み
- [ ] Python スクリプト基盤（代替・自動化用）
- [ ] v1: Gap Fill（差分充填）
- [ ] v2: Pattern-Based（パターン学習）
- [ ] v3: LLM API による生成
- [ ] v4: 制約最適化（補助）

## 関連ドキュメント

- [131 ADR-003 フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop)
- [125 推定値計算ロジック](/100-development/120-specifications/125-analyzer/time/001-estimation)
