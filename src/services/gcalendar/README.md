# Google Calendar → Supabase 同期モジュール

## 概要

Google Calendarの予定イベントをSupabaseに同期し、Toggl（実績）との予実管理を可能にする。

## 目的

- 予定（Google Calendar）と実績（Toggl）の比較分析
- 時間配分の意図と結果のギャップ把握
- 長期的な振り返りのためのアカウンタビリティ確保

## データソース

- Google Calendar API v3
- 認証: サービスアカウント（credential は Notion に保管中 → 将来的に Supabase 移行検討）

## 既存実装（移植元）

`C:\Users\shiba\HOBBY\doc\mng\src\services\gcalendar\`

| ファイル | 役割 |
|----------|------|
| `auth.js` | サービスアカウント認証（Notionからcredential取得） |
| `fetch-events.js` | イベント取得 + colorIdでTogglクライアントマッピング |
| `index.js` | キャッシュ付きエントリポイント |

## 新規実装（Deno）

```
src/services/gcalendar/
├── README.md          # このファイル
├── types.ts           # 型定義
├── auth.ts            # サービスアカウント認証
├── api.ts             # Google Calendar APIラッパー
├── fetch_events.ts    # イベント取得・変換
├── write_db.ts        # Supabase書き込み
├── sync_daily.ts      # 日次同期オーケストレーター
├── sync_all.ts        # 全件同期（初回移行・リカバリ用）
└── 001_create_schema.sql  # スキーマ・テーブル定義
```

## Supabaseスキーマ設計

### スキーマ: `gcalendar`

### テーブル: `events`

| カラム | 型 | 制約 | コメント |
|--------|-----|------|----------|
| id | TEXT | PK | Google Calendar イベントID |
| calendar_id | TEXT | NOT NULL | カレンダーID |
| summary | TEXT | | イベント名（Toggl description に相当） |
| description | TEXT | | イベント詳細（Toggl client に相当） |
| start_time | TIMESTAMPTZ | NOT NULL | 開始日時 |
| end_time | TIMESTAMPTZ | NOT NULL | 終了日時 |
| is_all_day | BOOLEAN | DEFAULT FALSE | 終日イベントフラグ |
| color_id | TEXT | | 時間の質的分類（Toggl project colorに直接対応） |
| status | TEXT | | confirmed / tentative / cancelled |
| recurring_event_id | TEXT | | 繰り返しイベントの親ID |
| etag | TEXT | | 変更検出用ETag |
| updated | TIMESTAMPTZ | | イベント更新日時（API） |
| synced_at | TIMESTAMPTZ | DEFAULT NOW() | Supabase同期日時 |

### Togglとの対応関係

| GCal (予定) | Toggl (実績) | 備考 |
|-------------|--------------|------|
| description | client | プロジェクト/案件 |
| summary | description | 具体的な作業内容 |
| color_id | project.color | 時間の質的分類（直接対応） |
| start_time / end_time | start / stop | 時間帯 |

### カラー マッピング

`notion.gcal_colors` テーブルで管理（gcalendar スキーマ外）。

| gcal_color_id | name | toggl_hex | gcal_hex |
|---------------|------|-----------|----------|
| 1 | drift | #566614 | #7986cb |
| 2 | household | #06a893 | #33b679 |
| ... | ... | ... | ... |

ビューで結合してカテゴリ名を取得する設計。

### テーブル: `tokens`（認証情報）

サービスアカウントの場合、トークン管理は不要（JWTで都度認証）。
credential JSON は環境変数 or Notion から取得。

## API → DB 変換処理

Google Calendar APIのイベントは終日イベントと通常イベントで異なるフィールドを返す。
DBでは統一した形式で保存する。

### 終日イベント vs 通常イベント

| 種別 | APIレスポンス | DB保存 |
|------|---------------|--------|
| 通常 | `start.dateTime`, `end.dateTime` | そのまま `start_time`, `end_time` |
| 終日 | `start.date`, `end.date` | `T00:00:00+09:00` を付与して TIMESTAMPTZ に変換 |

### 変換コード（TypeScript）

```typescript
// Google Calendar API レスポンスから DB レコードへの変換
function transformEvent(event: calendar_v3.Schema$Event, calendarId: string): DbEvent {
  // 終日イベントの場合は date を TIMESTAMPTZ に変換
  const startTime = event.start?.dateTime 
    ?? `${event.start?.date}T00:00:00+09:00`;
  const endTime = event.end?.dateTime 
    ?? `${event.end?.date}T00:00:00+09:00`;
  const isAllDay = !event.start?.dateTime;

  return {
    id: event.id!,
    calendar_id: calendarId,
    summary: event.summary ?? null,
    description: event.description ?? null,
    start_time: startTime,
    end_time: endTime,
    is_all_day: isAllDay,
    color_id: event.colorId ?? null,
    status: event.status ?? null,
    recurring_event_id: event.recurringEventId ?? null,
    etag: event.etag ?? null,
    updated: event.updated ?? null,
  };
}
```

## 環境変数

| 変数名 | 用途 |
|--------|------|
| `SUPABASE_URL` | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |
| `GOOGLE_CALENDAR_ID` | 対象カレンダーID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウントJSON（または Notion から取得） |
| `GCAL_SYNC_DAYS` | 同期日数（sync_daily.ts用、デフォルト: 3） |

---

## 日付範囲の計算パターン

全サービス共通の日付範囲計算パターン (`fetch_events.ts` の `fetchEventsByDays` 関数):

```typescript
// endDate = 明日（APIは排他的終点のため、今日を含めるには明日を指定）
const endDate = new Date();
endDate.setDate(endDate.getDate() + 1);

// startDate = endDate - (days + 1)
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - days - 1);
```

このパターンにより `days日前から今日まで` のデータを確実に取得できます。

## 同期仕様

### 対象期間

- デフォルト: 2019-01-01 〜 現在（Togglデータと合わせる）
- 環境変数で指定可能

### 更新戦略

- イベントIDをキーにupsert
- キャンセルされたイベントも `status = 'cancelled'` で保持

### 運用パターン

- 毎日の予定は基本的に recurring event を編集して管理
- color_id で時間の質的分類を行う

## 実装順序

### 現状

| 項目 | 状態 |
|------|------|
| README.md | ✅ 設計完了 |
| notion.gcal_colors | ✅ 移行済み |
| 既存Node.js実装 | ✅ 参照可能（auth.js, fetch-events.js） |
| サービスアカウント認証 | ✅ 取得済み |

### 実装手順（Togglパターン準拠）

| Step | ファイル | 役割 | 依存 | 状態 |
|------|----------|------|------|------|
| 1 | `001_create_schema.sql` | スキーマ・テーブル・RLS | - | [x] |
| 2 | `types.ts` | API型・DB型・同期結果型 | - | [x] |
| 3 | `auth.ts` | サービスアカウントJWT認証 | types.ts | [x] |
| 4 | `api.ts` | events.list + ページネーション | auth.ts | [x] |
| 5 | `fetch_events.ts` | データ取得 + API→DB変換 | api.ts, types.ts | [x] |
| 6 | `write_db.ts` | Supabase upsert | types.ts | [x] |
| 7 | `sync_daily.ts` | 同期オーケストレーター | 全モジュール | [x] |
| 8 | `.github/workflows/sync-gcalendar.yml` | GitHub Actions自動実行 | sync_daily.ts | [x] |

### 認証方式

サービスアカウントJWTを使用するため、Togglと異なりトークンテーブルは不要。
認証情報は環境変数 `GOOGLE_SERVICE_ACCOUNT_JSON` から取得（Base64エンコードまたは生JSON）。

### データパイプライン（Toggl対応）

```
Google Calendar API          変換                      Supabase
────────────────────────────────────────────────────────────────
events.list (pagination) →  transformEvent() →  gcalendar.events
```

Togglとの対応：

| Toggl | GCal | 備考 |
|-------|------|------|
| `client.ts` | `auth.ts` | 認証・HTTPリクエスト |
| `api.ts` | `api.ts` | データ取得 |
| `write_db.ts` | `write_db.ts` | DB書き込み（変換・upsert） |
| `sync_daily.ts` | `sync_daily.ts` | オーケストレーター |

### モジュール境界設計

#### types.ts
- `GCalApiEvent`: Google Calendar API レスポンス型
- `DbEvent`: gcalendar.events テーブル型
- `SyncResult`: 同期結果型

#### auth.ts
- `getAuthClient()`: サービスアカウントJWTクライアント取得
- 環境変数からcredential JSON取得
- スコープ: `https://www.googleapis.com/auth/calendar.readonly`

#### api.ts
- `fetchEvents(auth, options)`: イベント取得（ページネーション対応）
- `options`: timeMin, timeMax, calendarId

#### fetch_events.ts
- `transformEvent(event, calendarId)`: API→DB変換
- `fetchAllEvents(options)`: 認証〜取得〜変換のラッパー

#### write_db.ts
- `createGCalClient()`: Supabaseクライアント（gcalendar schema）
- `upsertEvents(events)`: バルクupsert

#### sync_daily.ts
- `syncGCalToSupabase(options)`: 全期間同期オーケストレーター
- `syncByDays(days)`: 日数指定同期（CLI実行時のデフォルト）
- デフォルト同期日数: 環境変数 `GCAL_SYNC_DAYS` で指定（デフォルト3日）

#### sync_all.ts
- `syncAllGCalEvents(startDate, endDate)`: 期間指定で全件同期
- 初回移行・リカバリ用
- CLI引数: `--start`, `--end` で期間指定可能

## Togglとの連携（将来）

予実管理ビューの設計時に、以下の結合を想定：

```sql
-- 日次予実比較
SELECT 
  DATE(g.start_time) AS date,
  g.description AS client_name,
  c.ja_name AS category,
  SUM(EXTRACT(EPOCH FROM (g.end_time - g.start_time)) * 1000) AS planned_ms,
  SUM(t.duration) AS actual_ms
FROM gcalendar.events g
LEFT JOIN notion.gcal_colors c ON g.color_id = c.gcal_color_id::text
LEFT JOIN toggl.time_entries t 
  ON DATE(g.start_time) = DATE(t.start)
  AND g.description = t.client_name
WHERE g.status = 'confirmed'
GROUP BY DATE(g.start_time), g.description, c.ja_name
```

## 参考

- [Google Calendar API](https://developers.google.com/calendar/api/v3/reference)
- 既存Node.js実装: `doc/mng/src/services/gcalendar/`
