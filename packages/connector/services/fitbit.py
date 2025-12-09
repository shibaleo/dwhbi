"""
Fitbit Web API → Supabase 同期

OAuth 2.0 認証を使用して Fitbit API からデータを取得し、
Supabase の raw.fitbit_* テーブルに保存する。

主な機能:
- OAuth 2.0 トークン管理（自動リフレッシュ）
- 5種類のヘルスデータ取得（睡眠、心拍、HRV、活動、SpO2）
- レート制限管理（150 req/h）
- JSTからUTCへのタイムゾーン変換
- 差分同期対応

使用例:
    python -c "import asyncio; from pipelines.services.fitbit import sync_fitbit; asyncio.run(sync_fitbit(days=3))"
"""

import asyncio
import httpx
from datetime import datetime, timedelta, timezone
from typing import TypedDict, Any, Optional
from zoneinfo import ZoneInfo

from pipelines.lib.logger import setup_logger
from pipelines.lib.credentials_vault import get_credentials, update_credentials
from pipelines.lib.db import get_supabase_client

logger = setup_logger(__name__)

# Constants
BASE_URL = "https://api.fitbit.com"
OAUTH_TOKEN_URL = "https://api.fitbit.com/oauth2/token"
DEFAULT_THRESHOLD_MINUTES = 60
RATE_LIMIT = 150
BATCH_SIZE = 1000
SLEEP_MAX_DAYS = 100
HEART_RATE_MAX_DAYS = 30
HRV_MAX_DAYS = 30
API_DELAY_MS = 100
CHUNK_DELAY_MS = 300

# Types
class OAuth2Credentials(TypedDict):
    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    scope: Optional[str]
    user_id: Optional[str]

class TokenResponse(TypedDict):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str
    scope: str
    user_id: str

class FitbitApiSleepLog(TypedDict):
    logId: int
    dateOfSleep: str
    startTime: str
    endTime: str
    duration: int
    efficiency: int
    isMainSleep: bool
    minutesAsleep: int
    minutesAwake: int
    timeInBed: int
    type: str
    levels: Optional[dict]

class DbSleep(TypedDict):
    date: str
    start_time: str
    end_time: str
    duration_ms: int
    efficiency: int
    is_main_sleep: bool
    minutes_asleep: int
    minutes_awake: int
    time_in_bed: int
    sleep_type: str
    levels: Optional[dict]
    log_id: int

class SyncStats(TypedDict):
    sleep: int
    activity: int
    heart_rate: int
    hrv: int
    spo2: int
    breathing_rate: int
    cardio_score: int
    temperature_skin: int

class SyncResult(TypedDict):
    success: bool
    stats: SyncStats

# Rate Limiter
class RateLimiter:
    def __init__(self):
        self.request_count = 0
        self.window_start = datetime.now(timezone.utc)

    def track_request(self) -> None:
        now = datetime.now(timezone.utc)
        if (now - self.window_start).total_seconds() >= 3600:
            self.request_count = 0
            self.window_start = now
        self.request_count += 1

    def get_remaining(self) -> int:
        return max(0, RATE_LIMIT - self.request_count)

_rate_limiter = RateLimiter()
_auth_cache: Optional[tuple[str, datetime]] = None

# Authentication
async def get_access_token(force_refresh: bool = False) -> str:
    global _auth_cache

    if not force_refresh and _auth_cache is not None:
        token, expires_at = _auth_cache
        minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        if minutes_until_expiry > DEFAULT_THRESHOLD_MINUTES:
            logger.info(f"Token valid ({minutes_until_expiry:.0f} min remaining)")
            return token

    result = await get_credentials("fitbit")
    if not result:
        raise ValueError("Fitbit credentials not found")

    credentials: OAuth2Credentials = result["credentials"]
    expires_at = result.get("expires_at")

    if not credentials.get("client_id") or not credentials.get("client_secret"):
        raise ValueError("Missing client_id or client_secret")
    if not credentials.get("access_token") or not credentials.get("refresh_token"):
        raise ValueError("Missing access_token or refresh_token")

    needs_refresh = force_refresh
    if not needs_refresh and expires_at:
        minutes_until_expiry = (expires_at - datetime.now(timezone.utc)).total_seconds() / 60
        needs_refresh = minutes_until_expiry <= DEFAULT_THRESHOLD_MINUTES

    if not needs_refresh and expires_at:
        logger.info(f"Token valid ({minutes_until_expiry:.0f} min remaining)")
        _auth_cache = (credentials["access_token"], expires_at)
        return credentials["access_token"]

    logger.info("Refreshing token...")
    new_token = await refresh_token_from_api(
        credentials["client_id"],
        credentials["client_secret"],
        credentials["refresh_token"],
    )

    new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=new_token["expires_in"])

    await update_credentials(
        "fitbit",
        {
            "access_token": new_token["access_token"],
            "refresh_token": new_token["refresh_token"],
            "scope": new_token.get("scope"),
            "user_id": new_token.get("user_id"),
        },
        new_expires_at,
    )

    logger.info(f"Token refreshed (expires: {new_expires_at.isoformat()})")
    _auth_cache = (new_token["access_token"], new_expires_at)
    return new_token["access_token"]

async def refresh_token_from_api(
    client_id: str, client_secret: str, refresh_token: str
) -> TokenResponse:
    async with httpx.AsyncClient() as client:
        auth = httpx.BasicAuth(client_id, client_secret)
        response = await client.post(
            OAUTH_TOKEN_URL,
            auth=auth,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if not response.is_success:
            raise httpx.HTTPStatusError(
                f"Token refresh error: {response.status_code} - {response.text}",
                request=response.request,
                response=response,
            )
        return response.json()

# Helper Functions
def format_fitbit_date(date: datetime) -> str:
    return date.strftime("%Y-%m-%d")

def convert_jst_to_utc(jst_time_string: str) -> str:
    jst_tz = ZoneInfo("Asia/Tokyo")
    jst_dt = datetime.fromisoformat(jst_time_string).replace(tzinfo=jst_tz)
    utc_dt = jst_dt.astimezone(timezone.utc)
    return utc_dt.isoformat()

def generate_periods(
    start_date: datetime, end_date: datetime, max_days: int
) -> list[tuple[datetime, datetime]]:
    periods = []
    current = start_date
    while current <= end_date:
        period_end = current + timedelta(days=max_days - 1)
        if period_end > end_date:
            period_end = end_date
        periods.append((current, period_end))
        current = period_end + timedelta(days=1)
    return periods

# API Client - Sleep
async def fetch_sleep_by_date_range(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> list[FitbitApiSleepLog]:
    _rate_limiter.track_request()
    start = format_fitbit_date(start_date)
    end = format_fitbit_date(end_date)
    response = await client.get(
        f"{BASE_URL}/1.2/user/-/sleep/date/{start}/{end}.json",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Accept-Language": "ja_JP",
        },
    )
    response.raise_for_status()
    data = response.json()
    return data.get("sleep", [])

async def fetch_sleep_data(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> list[FitbitApiSleepLog]:
    logger.info("Fetching sleep data...")
    results = []
    periods = generate_periods(start_date, end_date, SLEEP_MAX_DAYS)
    for period_from, period_to in periods:
        try:
            sleep_logs = await fetch_sleep_by_date_range(
                client, access_token, period_from, period_to
            )
            results.extend(sleep_logs)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000)
        except httpx.HTTPStatusError as e:
            logger.warning(
                f"Sleep chunk error ({format_fitbit_date(period_from)}-{format_fitbit_date(period_to)}): {e}"
            )
    logger.info(f"Sleep: {len(results)} records (remaining: {_rate_limiter.get_remaining()})")
    return results

# API Client - Heart Rate
async def fetch_heart_rate_by_date_range(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    _rate_limiter.track_request()
    start = format_fitbit_date(start_date)
    end = format_fitbit_date(end_date)
    response = await client.get(
        f"{BASE_URL}/1/user/-/activities/heart/date/{start}/{end}.json",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Accept-Language": "ja_JP",
        },
    )
    response.raise_for_status()
    data = response.json()
    return data.get("activities-heart", [])

async def fetch_heart_rate_data(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    logger.info("Fetching heart rate data...")
    results = []
    periods = generate_periods(start_date, end_date, HEART_RATE_MAX_DAYS)
    for period_from, period_to in periods:
        try:
            hr_data = await fetch_heart_rate_by_date_range(
                client, access_token, period_from, period_to
            )
            results.extend(hr_data)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000)
        except httpx.HTTPStatusError as e:
            logger.warning(
                f"Heart rate chunk error ({format_fitbit_date(period_from)}-{format_fitbit_date(period_to)}): {e}"
            )
    logger.info(f"Heart rate: {len(results)} days (remaining: {_rate_limiter.get_remaining()})")
    return results

# API Client - HRV
async def fetch_hrv_by_date_range(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    _rate_limiter.track_request()
    start = format_fitbit_date(start_date)
    end = format_fitbit_date(end_date)
    response = await client.get(
        f"{BASE_URL}/1/user/-/hrv/date/{start}/{end}.json",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Accept-Language": "ja_JP",
        },
    )
    response.raise_for_status()
    data = response.json()
    return data.get("hrv", [])

async def fetch_hrv_data(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> list[dict]:
    logger.info("Fetching HRV data...")
    results = []
    periods = generate_periods(start_date, end_date, HRV_MAX_DAYS)
    for period_from, period_to in periods:
        try:
            hrv_data = await fetch_hrv_by_date_range(
                client, access_token, period_from, period_to
            )
            results.extend(hrv_data)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000)
        except httpx.HTTPStatusError as e:
            logger.warning(
                f"HRV chunk error ({format_fitbit_date(period_from)}-{format_fitbit_date(period_to)}): {e}"
            )
    logger.info(f"HRV: {len(results)} days (remaining: {_rate_limiter.get_remaining()})")
    return results

# API Client - Activity
async def fetch_activity_daily_summary(
    client: httpx.AsyncClient,
    access_token: str,
    date: datetime,
) -> Optional[dict]:
    _rate_limiter.track_request()
    date_str = format_fitbit_date(date)
    try:
        response = await client.get(
            f"{BASE_URL}/1/user/-/activities/date/{date_str}.json",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
                "Accept-Language": "ja_JP",
            },
        )
        response.raise_for_status()
        data = response.json()
        return data.get("summary")
    except httpx.HTTPStatusError:
        return None

async def fetch_activity_data(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> dict[str, dict]:
    logger.info("Fetching activity data...")
    results = {}
    current = start_date
    dates = []
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=1)
    
    for i in range(0, len(dates), 3):
        batch = dates[i : i + 3]
        tasks = [
            fetch_activity_daily_summary(client, access_token, date)
            for date in batch
        ]
        summaries = await asyncio.gather(*tasks)
        for date, summary in zip(batch, summaries):
            if summary:
                results[format_fitbit_date(date)] = summary
        await asyncio.sleep(API_DELAY_MS / 1000)
    
    logger.info(f"Activity: {len(results)} days (remaining: {_rate_limiter.get_remaining()})")
    return results

# API Client - SpO2
async def fetch_spo2_by_date(
    client: httpx.AsyncClient,
    access_token: str,
    date: datetime,
) -> Optional[dict]:
    _rate_limiter.track_request()
    date_str = format_fitbit_date(date)
    try:
        response = await client.get(
            f"{BASE_URL}/1/user/-/spo2/date/{date_str}.json",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
                "Accept-Language": "ja_JP",
            },
        )
        response.raise_for_status()
        data = response.json()
        if data.get("value"):
            return data
        return None
    except httpx.HTTPStatusError:
        return None

async def fetch_spo2_data(
    client: httpx.AsyncClient,
    access_token: str,
    start_date: datetime,
    end_date: datetime,
) -> dict[str, dict]:
    logger.info("Fetching SpO2 data...")
    results = {}
    current = start_date
    dates = []
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=1)
    
    for i in range(0, len(dates), 3):
        batch = dates[i : i + 3]
        tasks = [
            fetch_spo2_by_date(client, access_token, date) for date in batch
        ]
        spo2_list = await asyncio.gather(*tasks)
        for date, spo2 in zip(batch, spo2_list):
            if spo2:
                results[format_fitbit_date(date)] = spo2
        await asyncio.sleep(API_DELAY_MS / 1000)
    
    logger.info(f"SpO2: {len(results)} days (remaining: {_rate_limiter.get_remaining()})")
    return results

# DB Transformation - Sleep
def to_db_sleep(items: list[FitbitApiSleepLog]) -> list[DbSleep]:
    return [
        {
            "date": item["dateOfSleep"],
            "start_time": convert_jst_to_utc(item["startTime"]),
            "end_time": convert_jst_to_utc(item["endTime"]),
            "duration_ms": item["duration"],
            "efficiency": item["efficiency"],
            "is_main_sleep": item["isMainSleep"],
            "minutes_asleep": item["minutesAsleep"],
            "minutes_awake": item["minutesAwake"],
            "time_in_bed": item["timeInBed"],
            "sleep_type": item["type"],
            "levels": item.get("levels"),
            "log_id": item["logId"],
        }
        for item in items
    ]

# DB Transformation - Heart Rate
def to_db_heart_rate_daily(items: list[dict]) -> list[dict]:
    return [
        {
            "date": item["dateTime"],
            "resting_heart_rate": item["value"].get("restingHeartRate"),
            "heart_rate_zones": item["value"].get("heartRateZones"),
        }
        for item in items
    ]

# DB Transformation - HRV
def to_db_hrv_daily(items: list[dict]) -> list[dict]:
    return [
        {
            "date": item["dateTime"],
            "daily_rmssd": item["value"]["dailyRmssd"],
            "deep_rmssd": item["value"]["deepRmssd"],
            "intraday": item.get("minutes"),
        }
        for item in items
    ]

# DB Transformation - Activity
def to_db_activity_daily(activity_map: dict[str, dict]) -> list[dict]:
    records = []
    for date, summary in activity_map.items():
        total_distance = None
        for d in summary.get("distances", []):
            if d.get("activity") == "total":
                total_distance = d.get("distance")
                break
        records.append(
            {
                "date": date,
                "steps": summary.get("steps"),
                "distance_km": total_distance,
                "floors": summary.get("floors"),
                "calories_total": summary.get("caloriesOut"),
                "calories_bmr": summary.get("caloriesBMR"),
                "calories_activity": summary.get("activityCalories"),
                "sedentary_minutes": summary.get("sedentaryMinutes"),
                "lightly_active_minutes": summary.get("lightlyActiveMinutes"),
                "fairly_active_minutes": summary.get("fairlyActiveMinutes"),
                "very_active_minutes": summary.get("veryActiveMinutes"),
            }
        )
    return records

# DB Transformation - SpO2
def to_db_spo2_daily(spo2_map: dict[str, dict]) -> list[dict]:
    records = []
    for date, data in spo2_map.items():
        if data.get("value"):
            records.append(
                {
                    "date": date,
                    "avg_spo2": data["value"]["avg"],
                    "min_spo2": data["value"]["min"],
                    "max_spo2": data["value"]["max"],
                }
            )
    return records

# DB Operations - Sleep
async def upsert_sleep(items: list[FitbitApiSleepLog]) -> int:
    if not items:
        return 0
    records = to_db_sleep(items)
    logger.info(f"Saving sleep... ({len(records)} records)")
    supabase = get_supabase_client()
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        response = (
            supabase.schema("raw")
            .table("fitbit_sleep")
            .upsert(batch, on_conflict="log_id")
            .execute()
        )
        if hasattr(response, "error") and response.error:
            logger.error(f"Sleep batch {i // BATCH_SIZE + 1}: {response.error}")
    logger.info(f"Saved {len(records)} sleep records")
    return len(records)

# DB Operations - Heart Rate
async def upsert_heart_rate_daily(items: list[dict]) -> int:
    if not items:
        return 0
    records = to_db_heart_rate_daily(items)
    logger.info(f"Saving heart rate... ({len(records)} records)")
    supabase = get_supabase_client()
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        response = (
            supabase.schema("raw")
            .table("fitbit_heart_rate_daily")
            .upsert(batch, on_conflict="date")
            .execute()
        )
        if hasattr(response, "error") and response.error:
            logger.error(f"Heart rate batch {i // BATCH_SIZE + 1}: {response.error}")
    logger.info(f"Saved {len(records)} heart rate records")
    return len(records)

# DB Operations - HRV
async def upsert_hrv_daily(items: list[dict]) -> int:
    if not items:
        return 0
    records = to_db_hrv_daily(items)
    logger.info(f"Saving HRV... ({len(records)} records)")
    supabase = get_supabase_client()
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        response = (
            supabase.schema("raw")
            .table("fitbit_hrv_daily")
            .upsert(batch, on_conflict="date")
            .execute()
        )
        if hasattr(response, "error") and response.error:
            logger.error(f"HRV batch {i // BATCH_SIZE + 1}: {response.error}")
    logger.info(f"Saved {len(records)} HRV records")
    return len(records)

# DB Operations - Activity
async def upsert_activity_daily(activity_map: dict[str, dict]) -> int:
    if not activity_map:
        return 0
    records = to_db_activity_daily(activity_map)
    logger.info(f"Saving activity... ({len(records)} records)")
    supabase = get_supabase_client()
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        response = (
            supabase.schema("raw")
            .table("fitbit_activity_daily")
            .upsert(batch, on_conflict="date")
            .execute()
        )
        if hasattr(response, "error") and response.error:
            logger.error(f"Activity batch {i // BATCH_SIZE + 1}: {response.error}")
    logger.info(f"Saved {len(records)} activity records")
    return len(records)

# DB Operations - SpO2
async def upsert_spo2_daily(spo2_map: dict[str, dict]) -> int:
    if not spo2_map:
        return 0
    records = to_db_spo2_daily(spo2_map)
    logger.info(f"Saving SpO2... ({len(records)} records)")
    supabase = get_supabase_client()
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        response = (
            supabase.schema("raw")
            .table("fitbit_spo2_daily")
            .upsert(batch, on_conflict="date")
            .execute()
        )
        if hasattr(response, "error") and response.error:
            logger.error(f"SpO2 batch {i // BATCH_SIZE + 1}: {response.error}")
    logger.info(f"Saved {len(records)} SpO2 records")
    return len(records)

# Main Sync Function
async def sync_fitbit(days: int = 3) -> SyncResult:
    logger.info(f"Starting Fitbit sync ({days} days)")
    end_date = datetime.now(timezone.utc) + timedelta(days=1)
    start_date = end_date - timedelta(days=days + 1)
    logger.info(f"Period: {format_fitbit_date(start_date)} - {format_fitbit_date(end_date)}")

    access_token = await get_access_token()

    async with httpx.AsyncClient(timeout=30.0) as client:
        logger.info("Fetching data from Fitbit API...")
        
        # 基本データ型を並列取得
        sleep_data, heart_rate_data, hrv_data = await asyncio.gather(
            fetch_sleep_data(client, access_token, start_date, end_date),
            fetch_heart_rate_data(client, access_token, start_date, end_date),
            fetch_hrv_data(client, access_token, start_date, end_date),
        )
        
        # 日毎のデータを並列取得
        activity_data, spo2_data = await asyncio.gather(
            fetch_activity_data(client, access_token, start_date, end_date),
            fetch_spo2_data(client, access_token, start_date, end_date),
        )

    logger.info("Saving to database...")
    
    # DB保存を並列実行
    (
        sleep_count,
        heart_rate_count,
        hrv_count,
        activity_count,
        spo2_count,
    ) = await asyncio.gather(
        upsert_sleep(sleep_data),
        upsert_heart_rate_daily(heart_rate_data),
        upsert_hrv_daily(hrv_data),
        upsert_activity_daily(activity_data),
        upsert_spo2_daily(spo2_data),
    )

    result: SyncResult = {
        "success": True,
        "stats": {
            "sleep": sleep_count,
            "activity": activity_count,
            "heart_rate": heart_rate_count,
            "hrv": hrv_count,
            "spo2": spo2_count,
            "breathing_rate": 0,
            "cardio_score": 0,
            "temperature_skin": 0,
        },
    }

    logger.info("Fitbit sync completed")
    logger.info(f"Sleep: {sleep_count}")
    logger.info(f"Activity: {activity_count}")
    logger.info(f"Heart rate: {heart_rate_count}")
    logger.info(f"HRV: {hrv_count}")
    logger.info(f"SpO2: {spo2_count}")
    logger.info(f"Total API requests: {_rate_limiter.request_count}")
    return result

# Entry Point
async def main():
    result = await sync_fitbit(days=3)
    exit(0 if result["success"] else 1)

if __name__ == "__main__":
    asyncio.run(main())
