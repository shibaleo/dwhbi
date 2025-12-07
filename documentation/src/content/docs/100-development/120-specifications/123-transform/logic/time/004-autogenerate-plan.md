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

### Claude API 料金

Claude API は従量課金（claude.ai の Pro/Max/Free プランとは別）:

| モデル | 入力 | 出力 |
|--------|------|------|
| Claude Sonnet 4 | $3 / 1M tokens | $15 / 1M tokens |
| Claude Haiku | $0.25 / 1M tokens | $1.25 / 1M tokens |

**plan 生成コスト見積もり（1日1回）**:
- 入力: 約 500 tokens × $3/1M = $0.0015
- 出力: 約 300 tokens × $15/1M = $0.0045
- **1日 $0.006 → 月 $0.18 程度**

コスト重視なら Haiku（約1/10）、品質重視なら Sonnet を選択。

### LLM による plan 生成

```python
import anthropic

def generate_plan_llm(
    target_date: date,
    estimate: dict,
    target: dict,
    constraints: list[dict],
    preferences: str = None
) -> dict:
    """
    LLM による柔軟な plan 生成
    """
    client = anthropic.Anthropic()

    prompt = f"""
以下の条件で {target_date} のスケジュールを生成してください。

## 推定時間（estimate）
{json.dumps(estimate, indent=2, ensure_ascii=False)}

## 目標時間（target）
{json.dumps(target, indent=2, ensure_ascii=False)}

## 固定予定（constraints）
{json.dumps(constraints, indent=2, ensure_ascii=False)}

## 好み・備考
{preferences or "特になし"}

## 出力形式
以下の JSON 形式で出力してください:
{{
  "plan": [
    {{"start_at": "HH:MM", "end_at": "HH:MM", "category": "カテゴリ名", "duration_min": 分}},
    ...
  ],
  "reasoning": "配置理由の説明",
  "warnings": ["達成困難な目標があれば警告"]
}}
"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    # JSON パース
    result = json.loads(response.content[0].text)

    return {
        "date": target_date.isoformat(),
        "plan": result["plan"],
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generation_method": "llm_claude",
            "reasoning": result.get("reasoning"),
            "warnings": result.get("warnings", [])
        }
    }
```

### LLM の利点

1. **柔軟な制約解釈**: 「できれば午前中に」「疲れているので軽めに」
2. **説明付き**: なぜこの配置にしたかを自然言語で説明
3. **警告機能**: 「目標達成は難しいです。明日に回すことを推奨します」
4. **対話的調整**: 「もう少し早めに始めたい」→ 再生成

### 出力例

```json
{
  "date": "2025-12-07",
  "plan": [
    {"start_at": "09:00", "end_at": "12:00", "category": "Education", "duration_min": 180},
    {"start_at": "14:00", "end_at": "16:00", "category": "Education", "duration_min": 120},
    {"start_at": "16:30", "end_at": "18:30", "category": "Education", "duration_min": 120}
  ],
  "meta": {
    "generated_at": "2025-12-07T08:00:00Z",
    "generation_method": "llm_claude",
    "reasoning": "Education が 420分不足しています。朝の集中しやすい時間帯（9:00-12:00）に 180分、午後の会議後（14:00-16:00）に 120分、夕方（16:30-18:30）に 120分を配置しました。",
    "warnings": []
  }
}
```

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

#### セッション例

```
User: 明日の計画を立てよう

Claude: [PostgreSQL MCP で Supabase 参照]
まず最近の傾向と明日の情報を確認しますね。

📊 **最近の傾向（過去7日）**
- Education: 平均 180分/日（目標 600分の 30%）
- Work: 平均 520分/日（目標達成率 108%）
- Sleep: 平均 390分/日（目標の 93%）

Education が目標を大きく下回っています。

🔮 **明日の予測（estimate）**
- day_type: Work
- Education: 200分（過去パターンから予測）
- Work: 500分
- Sleep: 400分

🎯 **明日の目標（target）**
- Education: 600分（gap: 400分）
- Work: 480分
- Sleep: 420分

予測だと Education は 200分ですが、目標は 600分です。
400分の差を埋めるのは現実的に厳しそうですね。
どのくらいなら達成できそうですか？

User: 300分くらいならいけるかな

Claude: 300分（5時間）なら現実的ですね。
予測より +100分なので、意識的に時間を確保する必要があります。

いつ頃 Education の時間を取れそうですか？
- 朝（集中しやすい）
- 午後（まとまった時間）
- 夜（仕事後）

User: 朝と午後で分けたい。10:00-12:00 は会議がある

Claude: 了解です。では:
- 08:00-10:00: Education（2時間）← 朝の集中タイム
- 13:00-16:00: Education（3時間）← 午後のブロック

合計 5時間で、目標 300分を達成できます。

ただ、3時間連続は疲れるかもしれません。
14:30 くらいで休憩を入れますか？

User: そうだね、14:30-15:00 は休憩にしよう

Claude: 最終プラン:
- 08:00-10:00: Education（120分）
- 10:00-12:00: Meeting（固定）
- 13:00-14:30: Education（90分）
- 14:30-15:00: Break
- 15:00-16:30: Education（90分）

Education 合計: 300分 ✅

これで Google Calendar に登録しますか？

User: OK、登録して
```

#### LLM 入力用ビュー: v_time_llm_context

Claude が MCP 経由で参照するビュー:

```sql
-- core.v_time_llm_context
-- Claude Desktop が PostgreSQL MCP 経由で参照
SELECT
  e.date_day AS date,
  d.day_type,
  e.time_category_personal AS category,
  e.estimate_min,
  t.target_min,
  GREATEST(0, t.target_min - e.estimate_min) AS gap_min,
  t.direction
FROM v_time_daily_estimate e
JOIN dim_day_types d ON e.date_day = d.date_day
LEFT JOIN v_time_daily_target t
  ON e.date_day = t.date_day
  AND e.time_category_personal = t.time_category_personal
WHERE e.date_day = :target_date
ORDER BY gap_min DESC
```

#### メリット

| 観点 | CSV エクスポート | PostgreSQL MCP |
|------|------------------|----------------|
| 手間 | CSV 出力が必要 | 直接参照 |
| リアルタイム性 | スナップショット | 常に最新 |
| 柔軟性 | 固定フォーマット | 任意のクエリ可能 |
| 対話性 | ファイル添付 | 会話中に参照 |

## 補助: 制約最適化ライブラリ

LLM の前処理・後処理として、制約最適化ライブラリを併用することも可能:

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

### Google Calendar MCP（推奨）

Claude Desktop に Google Calendar MCP を設定することで、
対話セッション内で直接 Google Calendar にイベントを作成できる。

#### セッション例（続き）

```
User: OK、そのプランで Google Calendar に登録して

Claude: [Google Calendar MCP でイベント作成]
以下のイベントを作成しました:

✅ 08:00-10:00 Education
✅ 13:00-16:00 Education
✅ 16:30-18:00 Leisure

明日の準備は完了です！

User: ありがとう。あと、10:00-12:00 の会議も入れておいて

Claude: [Google Calendar MCP でイベント作成]
✅ 10:00-12:00 Meeting

追加しました。明日のスケジュール全体:
- 08:00-10:00 Education
- 10:00-12:00 Meeting
- 13:00-16:00 Education
- 16:30-18:00 Leisure
```

#### メリット

| 観点 | Python 実装 | Google Calendar MCP |
|------|-------------|---------------------|
| 実装コスト | API 認証 + コード実装 | MCP 設定のみ |
| 柔軟性 | コード修正が必要 | 対話で調整可能 |
| 確認 | 実行後に確認 | 登録前に確認・修正可能 |
| 追加変更 | 再実行が必要 | その場で追加可能 |

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

#### トレードオフ

| 項目 | 内容 |
|------|------|
| ✅ メリット | 実装不要、柔軟、対話的 |
| ⚠️ デメリット | 毎日 Claude Desktop を開く必要あり |

**判断**: 自動化より柔軟性を優先する場合に適切。
振り返りセッション自体に価値があるため、毎日開くことはむしろ習慣化のメリットになりうる。

### 代替: Python 実装（自動化用）

完全自動化が必要な場合の実装例:

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

- [ADR-003 フィードバックループ](/100-development/130-design/131-decisions/adr_003-feedback-loop)
- [001 推定値計算ロジック](/100-development/120-specifications/123-transform/logic/time/001-estimation)
- [004 目標管理（target）](/100-development/120-specifications/123-transform/schema/core/004-target)
- [005 推定値（estimate）](/100-development/120-specifications/123-transform/schema/core/005-estimate)
