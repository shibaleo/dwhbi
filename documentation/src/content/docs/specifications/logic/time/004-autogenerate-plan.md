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

| 情報 | 形式 | 理由 |
|------|------|------|
| actual | レコード | 実績（Google Calendar から取得） |
| estimate | 集計 | 日次予測値（ML で計算） |
| target | 集計 | 目標値（seeds で定義） |
| plan | レコード | 自動生成スケジュール（Google Calendar へ書き戻し可能） |

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

## 将来拡張: 制約最適化

より高度なスケジューリングには制約最適化ライブラリを使用:

| ライブラリ | 特徴 |
|------------|------|
| **OR-Tools** | Google の最適化ツール、スケジューリング問題に強い |
| **PuLP** | 線形計画法、シンプルな制約充足 |
| **OptaPlanner** | Java ベース、複雑な制約対応 |

### 制約の例

```python
constraints = [
    # 固定イベント（動かせない）
    {"type": "fixed", "start": "12:00", "end": "13:00", "label": "Lunch"},
    {"type": "fixed", "start": "09:00", "end": "10:00", "label": "Meeting"},

    # 優先時間帯
    {"type": "preferred", "category": "Education", "hours": [9, 10, 14, 15]},

    # 連続時間の最大値
    {"type": "max_continuous", "category": "Work", "max_min": 120},

    # 休憩挿入
    {"type": "break_after", "duration_min": 90, "break_min": 15},
]
```

## ML 用ビュー設計

時間帯パターン学習用のビュー:

### v_time_ml_hourly（時間帯パターンビュー）

```sql
-- core.v_time_ml_hourly
-- 時間帯別のカテゴリ分布を学習用に提供
SELECT
  a.record_date AS ds,
  EXTRACT(HOUR FROM a.start_at) AS hour,
  a.time_category_personal AS category,
  SUM(a.duration_seconds) / 60 AS duration_min,
  d.day_type,
  EXTRACT(DOW FROM a.record_date) AS dow

FROM fct_time_records_actual a
JOIN dim_day_types d ON a.record_date = d.date_day
GROUP BY 1, 2, 3, 5, 6
```

## Google Calendar 連携

生成された plan を Google Calendar に書き戻す:

```python
def push_plan_to_gcal(
    plan: dict,
    calendar_id: str,
    category_color_map: dict
) -> list[str]:
    """
    生成された plan を Google Calendar イベントとして作成
    """
    created_event_ids = []

    for item in plan['plan']:
        event = {
            'summary': f"[Plan] {item['category']}",
            'start': {'dateTime': item['start_at'], 'timeZone': 'Asia/Tokyo'},
            'end': {'dateTime': item['end_at'], 'timeZone': 'Asia/Tokyo'},
            'colorId': category_color_map.get(item['category'], '1'),
            'description': f"Auto-generated plan (confidence: {item['confidence']})"
        }
        # Google Calendar API で作成
        result = service.events().insert(calendarId=calendar_id, body=event).execute()
        created_event_ids.append(result['id'])

    return created_event_ids
```

## 実装ステータス

- [ ] Python スクリプト基盤
- [ ] v1: Gap Fill（差分充填）
- [ ] v2: Pattern-Based（パターン学習）
- [ ] v_time_ml_hourly ビュー
- [ ] 制約定義フォーマット
- [ ] Google Calendar 書き戻し
- [ ] v3: 制約最適化（将来）

## 関連ドキュメント

- [ADR-003 フィードバックループ](/design/decisions/adr_003-feedback-loop)
- [001 推定値計算ロジック](/specifications/logic/time/001-estimation)
- [004 目標管理（target）](/specifications/schema/core/004-target)
- [005 推定値（estimate）](/specifications/schema/core/005-estimate)
