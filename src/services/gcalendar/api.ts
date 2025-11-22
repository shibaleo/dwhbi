/**
 * Google Calendar API ラッパー
 * 
 * events.listエンドポイントをページネーション対応で呼び出す
 */

import { authenticatedFetch } from "./auth.ts";
import {
  GCalApiEvent,
  GCalEventsListResponse,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const MAX_RESULTS_PER_PAGE = 2500; // API最大値

// =============================================================================
// Types
// =============================================================================

export interface FetchEventsOptions {
  /** カレンダーID */
  calendarId: string;
  /** 開始日時（ISO 8601） */
  timeMin: string;
  /** 終了日時（ISO 8601） */
  timeMax: string;
  /** 取得するフィールド（デフォルト: 必要最小限） */
  fields?: string;
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * イベント一覧を取得（ページネーション対応）
 */
export async function fetchEvents(options: FetchEventsOptions): Promise<GCalApiEvent[]> {
  const { calendarId, timeMin, timeMax, fields } = options;
  
  const allEvents: GCalApiEvent[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;
  
  // 取得するフィールドを指定（帯域節約）
  const fieldsParam = fields ?? 
    "items(id,etag,status,summary,description,colorId,recurringEventId,start,end,updated),nextPageToken";
  
  do {
    pageCount++;
    
    // URLパラメータ構築
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(MAX_RESULTS_PER_PAGE),
      singleEvents: "true",      // 繰り返しイベントを展開
      orderBy: "startTime",
      fields: fieldsParam,
    });
    
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    
    const response = await authenticatedFetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Calendar API error: ${response.status} ${errorText}`);
    }
    
    const data = await response.json() as GCalEventsListResponse;
    
    if (data.items && data.items.length > 0) {
      allEvents.push(...data.items);
    }
    
    pageToken = data.nextPageToken;
    
    // レート制限対策: ページ間に100ms待機
    if (pageToken) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
  } while (pageToken);
  
  console.log(`[INFO]     Fetched ${allEvents.length} events in ${pageCount} page(s)`);
  
  return allEvents;
}

/**
 * カレンダーIDを環境変数から取得
 */
export function getCalendarId(): string {
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID environment variable is not set");
  }
  return calendarId;
}
