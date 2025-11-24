# Google Calendar 同期モジュール

Google Calendar API から予定イベントを取得し、Supabase `gcalendar` スキーマに同期する。Toggl（実績）との予実管理を可能にする。

## クイックスタート

### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | Yes | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `GOOGLE_CALENDAR_ID` | Yes | 対象カレンダーID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | サービスアカウントJSON（Base64または生JSON） |
| `GCAL_SYNC_DAYS` | No | 同期日数（デフォルト: 3） |

### 実行コマンド

```bash
# 日次同期（直近3日間）
deno run --allow-env --allow-net --allow-read sync_daily.ts

# 日次同期（直近7日間）
GCAL_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read sync_daily.ts

# 全件同期（期間指定）
deno run --allow-env --allow-net --allow-read sync_all.ts --start=2024-01-01 --end=2024-12-31
```

---

## アーキテクチャ

### データパイプライン

```
Google Calendar API           変換                    Supabase
──────────────────────────────────────────────────────────────
events.list (pagination) →  transformEvent()  →  gcalendar.events
```

### Toggl との対応関係

| GCal (予定) | Toggl (実績) | 備考 |
|-------------|--------------|------|
| description | client | プロジェクト/案件 |
| summary | description | 具体的な作業内容 |
| color_id | project.color | 時間の質的分類（直接対応） |
| start_time / end_time | start / stop | 時間帯 |

### ファイル構成

| ファイル | 責務 | 実行可能 |
|----------|------|----------|
| `types.ts` | API/DB型定義 | No |
| `auth.ts` | サービスアカウントJWT認証 | No |
| `api.ts` | Google Calendar APIクライアント（ページネーション対応） | No |
| `fetch_data.ts` | データ取得・API→DB変換 | No |
| `write_db.ts` | DB書き込み（upsert） | No |
| `sync_daily.ts` | 日次同期オーケストレーター | Yes |
| `sync_all.ts` | 全件同期（初回移行・リカバリ用） | Yes |

---

## モジュール詳細

### types.ts

API型・DB型・同期結果型を定義。

```typescript
// API型（Google Calendar API レスポンス）
interface GCalApiEvent {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  colorId?: string;
  status?: string;
  recurringEventId?: string;
  etag?: string;
  updated?: string;
}

// DB型
interface DbEvent {
  id: string;               // Google Calendar イベントID
  calendar_id: string;
  summary: string | null;
  description: string | null;
  start_time: string;       // TIMESTAMPTZ
  end_time: string;         // TIMESTAMPTZ
  is_all_day: boolean;
  color_id: string | null;
  status: string | null;    // confirmed / tentative / cancelled
  recurring_event_id: string | null;
  etag: string | null;
  updated: string | null;
}

// 同期結果型
interface SyncResult {
  success: boolean;
  timestamp: string;
  stats: { events: number };
  elapsedSeconds: number;
  error?: string;
}
```

### auth.ts

サービスアカウントJWT認証。トークンテーブルは不要（都度JWT生成）。

```typescript
// サービスアカウントクライアント取得
async function getAuthClient(): Promise<JWT>
```

スコープ: `https://www.googleapis.com/auth/calendar.readonly`

### api.ts

Google Calendar APIクライアント。

```typescript
// イベント取得（ページネーション対応）
async function fetchEvents(auth: JWT, options: {
  calendarId: string;
  timeMin: string;
  timeMax: string;
}): Promise<GCalApiEvent[]>
```

### fetch_data.ts

データ取得・変換。

```typescript
// API → DB 変換
function transformEvent(event: GCalApiEvent, calendarId: string): DbEvent

// 認証〜取得〜変換のラッパー
async function fetchAllEvents(options: FetchOptions): Promise<DbEvent[]>

// 日数指定取得
async function fetchEventsByDays(days: number): Promise<DbEvent[]>
```

**終日イベントの変換処理**:

```typescript
// 終日イベント: start.date → T00:00:00+09:00 を付与して TIMESTAMPTZ に変換
// 通常イベント: start.dateTime をそのまま使用
const startTime = event.start?.dateTime ?? `${event.start?.date}T00:00:00+09:00`;
```

### write_db.ts

Supabase `gcalendar` スキーマへの書き込み。

```typescript
// Supabaseクライアント
function createGCalClient(): SupabaseClient

// バルクupsert
async function upsertEvents(events: DbEvent[]): Promise<UpsertResult>
```

### sync_daily.ts

日次同期オーケストレーター。

```typescript
async function syncGCalToSupabase(options?: FetchOptions): Promise<SyncResult>
async function syncByDays(days: number): Promise<SyncResult>
```

### sync_all.ts

全件同期（初回移行・リカバリ用）。

```typescript
async function syncAllGCalEvents(startDate: Date, endDate: Date): Promise<void>
```

---

## データベーススキーマ

### gcalendar スキーマ

| テーブル | 主キー | 説明 |
|----------|--------|------|
| `events` | `id` (TEXT) | カレンダーイベント（Google イベントID） |

### events テーブル詳細

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | TEXT | PK | Google Calendar イベントID |
| calendar_id | TEXT | NOT NULL | カレンダーID |
| summary | TEXT | | イベント名 |
| description | TEXT | | イベント詳細 |
| start_time | TIMESTAMPTZ | NOT NULL | 開始日時 |
| end_time | TIMESTAMPTZ | NOT NULL | 終了日時 |
| is_all_day | BOOLEAN | DEFAULT FALSE | 終日イベントフラグ |
| color_id | TEXT | | カラーID |
| status | TEXT | | confirmed / tentative / cancelled |
| recurring_event_id | TEXT | | 繰り返しイベントの親ID |
| etag | TEXT | | 変更検出用ETag |
| updated | TIMESTAMPTZ | | イベント更新日時（API） |
| synced_at | TIMESTAMPTZ | DEFAULT NOW() | 同期日時 |

### カラーマッピング

`notion.gcal_colors` テーブルで管理（gcalendar スキーマ外）。

```sql
-- ビューでカテゴリ名を取得
SELECT e.*, c.ja_name AS category
FROM gcalendar.events e
LEFT JOIN notion.gcal_colors c ON e.color_id = c.gcal_color_id::text
```

---

## API仕様

### 認証方式

サービスアカウントJWT。credential JSON は環境変数から取得。

### エンドポイント

| エンドポイント | 説明 |
|---------------|------|
| `events.list` | イベント一覧取得（ページネーション対応） |

### 制約・制限

| 項目 | 値 |
|------|-----|
| デフォルト取得期間 | 2019-01-01 〜 現在 |
| ページサイズ | 最大2500件/リクエスト |

---

## 日付範囲の計算パターン

全サービス共通パターン:

```typescript
// endDate = 明日（APIは排他的終点のため）
const endDate = new Date();
endDate.setDate(endDate.getDate() + 1);

// startDate = endDate - (days + 1)
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - days - 1);
```

このパターンにより `days日前から今日まで` のデータを確実に取得。

---

## テスト

### 単体テスト

```bash
# 全テスト実行（18件）
deno test test/gcalendar/ --allow-env --allow-read

# 個別実行
deno test test/gcalendar/write_db.test.ts --allow-env --allow-read  # transformEvent 変換関数
```

### 手動統合テスト

```bash
# 日次同期テスト（3日間）
GCAL_SYNC_DAYS=3 deno run --allow-env --allow-net --allow-read sync_daily.ts
```

---

## GitHub Actions

定期実行は `sync-all.yml` に統合（毎日 JST 00:00）。

個別実行は `sync-gcalendar.yml` で手動トリガー可能。

---

## 初回セットアップ

1. Google Cloud Console でプロジェクト作成
2. Calendar API を有効化
3. サービスアカウント作成、JSONキーをダウンロード
4. カレンダーの共有設定でサービスアカウントのメールアドレスを追加
5. 環境変数 `GOOGLE_SERVICE_ACCOUNT_JSON` にJSONを設定

---

## Toggl との連携（将来）

予実管理ビューの設計:

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

---

## 参考リンク

- [Google Calendar API v3](https://developers.google.com/calendar/api/v3/reference)

---

## DWH移行計画

### 概要

現在の `gcalendar` スキーマを `raw` スキーマに移行し、DWH 3層アーキテクチャを採用する。

```
現在:  gcalendar.events
    ↓
移行後:
  raw.gcalendar_events           ← 生データ（テーブル）
      ↓
  staging.stg_gcalendar__events  ← クリーニング済み（ビュー）
      ↓
  marts.fct_planned_time         ← ビジネスエンティティ（ビュー）
```

### 変更点

| 項目 | 現在 | 移行後 |
|------|------|--------|
| スキーマ | `gcalendar` | `raw` |
| テーブル名 | `events` | `gcalendar_events` |
| DBクライアント | supabase-js (REST API) | postgres.js (直接接続) |
| API公開 | Exposed | Not Exposed |

### write_db.ts 変更内容

```typescript
// 現在
import { createClient } from "npm:@supabase/supabase-js@2";
const supabase = createClient(url, key);
const gcalendar = supabase.schema("gcalendar");
await gcalendar.from("events").upsert(data, { onConflict: "id" });

// 移行後
import postgres from "npm:postgres";
const sql = postgres(DATABASE_URL);
await sql`
  INSERT INTO raw.gcalendar_events ${sql(records)}
  ON CONFLICT (id) DO UPDATE SET
    summary = EXCLUDED.summary,
    description = EXCLUDED.description,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    status = EXCLUDED.status,
    synced_at = now()
`;
```

### 環境変数追加

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | PostgreSQL 直接接続文字列 |

### マイグレーション手順

1. `raw.gcalendar_events` テーブルを作成
2. `gcalendar.events` から `raw.gcalendar_events` にデータ移行
3. `write_db.ts` を postgres.js に書き換え
4. `staging.stg_gcalendar__events` ビューを作成
5. 旧 `gcalendar` スキーマを削除（データ確認後）
