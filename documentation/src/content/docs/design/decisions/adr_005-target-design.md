---
title: ADR-005 target設計
description: 目標管理のデータモデル設計（グループ + バージョン管理）
---

# ADR-005: target設計

## ステータス

採用（2025-12-07）

## コンテキスト

targetは「起こしたい」＝目標値を表す。planとは異なり、外部サービス（Google Calendar）ではなくDWH内で管理する。目標値の変更履歴を追跡可能にし、期間を持つ目標を表現する必要がある。

## 決定

2テーブル構成（グループ + 目標）でバージョン管理を行う。

## 設計方針

1. **2テーブル構成**: グループ（不変属性）と目標（バージョン管理対象）を分離
2. **スコープ期間を持つ目標**: 「いつからいつまでに」という対象期間（scope）を明示
3. **バージョン管理**: 同一目標の変更履歴をテーブル内で管理（gitに依存しない）
4. **分単位で管理**: actualは秒単位だが、目標は分単位で十分

## 概念の整理

| 概念 | 意味 | 例 |
|------|------|-----|
| **group** | 目標の不変属性（カテゴリ、day_type、direction） | 「12月のEducation目標（more）」 |
| **scope** | 目標が対象とする期間 | 「12/6〜12/31の間に」 |
| **valid** | この目標設定自体の有効期間 | 「この設定は12/6に作成、12/7に無効化」 |
| **version** | グループ内のバージョン | 「1.0.0」→「1.1.0」（下方修正） |

## mst_time_target_groups（目標グループマスタ）

目標の不変属性を定義。すべてのtargetは必ず1つのgroupに属する。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | PK |
| name | TEXT | グループ名（ユーザー定義、例: edu_dec） |
| time_category_personal | TEXT | FK → mst_time_personal_categories.name |
| day_type | TEXT | day_type値（Work, Leisure等）または 'all' |
| direction | TEXT | more / less / neutral |
| valid_from | DATE | グループの有効開始（トリガーで自動更新） |
| valid_until | DATE | グループの有効終了（トリガーで自動更新、nullなら現行） |
| description | TEXT | グループの説明 |

**direction定義:**

| direction | 意味 | 達成判定 |
|-----------|------|----------|
| more | 多いほど良い | actual >= target |
| less | 少ないほど良い | actual <= target |
| neutral | 目安値 | 判定なし（参考値） |

**valid_from/valid_untilの管理:**
- groupsのvalid_from/valid_untilは、所属するtargetsの最新バージョン（valid_until=null）から**トリガーで自動同期**される
- seeds（CSV）投入後、Supabaseトリガーが整合性を保証

**例:**
```csv
id,name,time_category_personal,day_type,direction,valid_from,valid_until,description
1,edu_dec,Education,Education,more,2025-12-07,,2025年12月のEducation目標
2,sleep_daily,Sleep,all,neutral,2025-01-01,,日次睡眠目標
3,drift_daily,Drift,all,less,2025-01-01,,日次漂流上限
```

## mst_time_targets（目標マスタ）

バージョン管理対象の目標値を定義。

| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER | PK |
| group_id | INTEGER | FK → mst_time_target_groups.id |
| version | TEXT | セマンティックバージョン（1.0.0等） |
| scope_start | DATE | 目標対象期間の開始 |
| scope_end | DATE | 目標対象期間の終了 |
| target_min | INTEGER | 目標時間（分単位） |
| valid_from | DATE | この設定の有効開始 |
| valid_until | DATE | この設定の有効終了（nullなら現行） |
| description | TEXT | このバージョンの説明 |

**例:**
```csv
id,group_id,version,scope_start,scope_end,target_min,valid_from,valid_until,description
1,1,1.0.0,2025-12-06,2025-12-31,600,2025-12-06,2025-12-07,Edu 10h
2,1,1.1.0,2025-12-06,2025-12-31,480,2025-12-07,,Edu 8h（下方修正）
3,2,1.0.0,2025-01-01,2099-12-31,420,2025-01-01,,7時間/日
4,3,1.0.0,2025-01-01,2099-12-31,60,2025-01-01,,1時間/日以下
```

## バージョニング制約

同一グループ内のバージョン管理には以下の制約が適用される。

| 制約 | 説明 |
|------|------|
| **バージョンのソート可能性** | 同一group_id内でversionはセマンティックバージョニング順にソート可能であること |
| **valid_until=nullの一意性** | 同一group_id内でvalid_until=nullを持つレコードは最大1つ（＝現行バージョン） |
| **期間の連続性** | 同一group_id内で、前バージョンのvalid_untilが次バージョンのvalid_fromと一致すること |
| **groups同期** | groupsのvalid_from/valid_untilは、最新バージョン（valid_until=null）と同一であること |

## トリガーによる整合性保証

targetsへのINSERT/UPDATE時に、所属するgroupのvalid_from/valid_untilを自動更新する。

```sql
-- mst_time_targets INSERT/UPDATE後にgroupsを同期するトリガー
CREATE OR REPLACE FUNCTION sync_target_group_validity()
RETURNS TRIGGER AS $$
BEGIN
  -- 最新バージョン（valid_until=null）のvalid_fromでgroupを更新
  UPDATE mst_time_target_groups g
  SET
    valid_from = t.valid_from,
    valid_until = t.valid_until  -- 常にnull
  FROM mst_time_targets t
  WHERE t.group_id = g.id
    AND t.valid_until IS NULL
    AND g.id = NEW.group_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_target_group_validity
AFTER INSERT OR UPDATE ON mst_time_targets
FOR EACH ROW
EXECUTE FUNCTION sync_target_group_validity();
```

**注**: seeds（CSV）投入時は一時的に不整合が生じるが、トリガーにより最終的に整合する。

## バージョン管理の例

```
シナリオ: 年末までにEducation 10hの目標

Day 1 (12/6): 目標を立てる
  group: id=1, name=edu_dec, direction=more
  target: id=1, group_id=1, version=1.0.0
          scope: 12/6〜12/31, target: 600min
          valid_from=12/6, valid_until=null

Day 2 (12/7): 10hは無理そうなので8hに下方修正
  target id=1を更新: valid_until=12/7
  target id=2を追加: group_id=1, version=1.1.0
          scope: 12/6〜12/31, target: 480min
          valid_from=12/7, valid_until=null
```

**制約の適用状況:**
- group_id=1内でvalid_until=nullはid=2のみ ✓
- version 1.0.0 < 1.1.0 でソート可能 ✓
- id=1のvalid_until(12/7) = id=2のvalid_from(12/7) で連続 ✓

## fct_time_target（日次目標ファクト）

日付 × day_type → 適用される目標値を展開したビュー。

```sql
-- fct_time_target（core層ビュー）
SELECT
  d.date,
  d.day_type,
  g.id as group_id,
  g.name as group_name,
  g.time_category_personal,
  g.direction,
  t.target_min
FROM dim_date d
JOIN mst_time_target_groups g
  ON (g.day_type = d.day_type OR g.day_type = 'all')
JOIN mst_time_targets t
  ON t.group_id = g.id
  AND d.date BETWEEN t.scope_start AND t.scope_end
  AND d.date BETWEEN t.valid_from AND COALESCE(t.valid_until, '9999-12-31')
```

## 整合性チェック

**チェック必要:**
- 同day_typeの日次目標合計が1440min（24h）を超えないこと

```sql
-- day_type別に24hを超えないかチェック
SELECT
  g.day_type,
  SUM(t.target_min) as total_min
FROM mst_time_target_groups g
JOIN mst_time_targets t ON t.group_id = g.id
WHERE g.direction IN ('more', 'neutral')
  AND t.valid_until IS NULL  -- 現行目標のみ
GROUP BY g.day_type
HAVING SUM(t.target_min) > 1440;
```

**チェック不要:**
- direction=lessの目標は上限なので合計に含めない

## 未決定事項

1. **セマンティックバージョニング定義**: メジャー/マイナー/パッチの具体的定義は運用後に検討

| 変更種別 | バージョン変更 | 例 |
|----------|---------------|-----|
| メジャー | X.0.0 | 目標の根本的な見直し |
| マイナー | -.Y.0 | 目標値の調整（上方/下方修正） |
| パッチ | -.-.Z | 説明文の修正など |

## 将来の拡張方針

### 目標管理のUI

現時点ではUIは後回しとし、seedsで設計を進める。

**現在**: seeds（CSV）で目標を管理
- 変更頻度が低い長期目標に適している
- git管理でバージョン履歴が残る
- dbt seedで反映

**将来**: Supabaseテーブルに移行
- 動的に目標を変更可能に
- Admin ConsoleからのUI編集を想定

## 関連

- [ADR-003 時間管理フィードバックループ](/design/decisions/adr_003-time-feedback-loop)
- [ADR-004 day_type設計](/design/decisions/adr_004-day-type-design)
