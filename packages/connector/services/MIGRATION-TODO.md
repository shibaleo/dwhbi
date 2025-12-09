# Connector Services TypeScript Migration TODO

## Overview

This document describes the migration plan for remaining Python services to TypeScript.
Currently migrated: `toggl_track/`, `google_calendar/`

## Services to Migrate

### 1. airtable.py (~430 lines)

**Authentication:** Personal Access Token (PAT) - Simple Bearer token

**Script Structure:**
```
airtable.py
├── Types (AirtableBase, AirtableTable, AirtableRecord, DbBase, DbTable, DbRecord)
├── Authentication
│   └── get_access_token() - PAT from vault (simple, no refresh needed)
├── API Client
│   ├── fetch_bases() - GET /meta/bases
│   ├── fetch_tables() - GET /meta/bases/{id}/tables
│   └── fetch_records() - GET /{baseId}/{tableId} (pagination)
├── DB Transformation
│   ├── to_db_base()
│   ├── to_db_table()
│   └── to_db_record()
├── DB Write
│   ├── upsert_bases()
│   ├── upsert_tables()
│   └── upsert_records()
└── Main: sync_airtable(base_ids?, include_records?)
```

**Migration Notes:**
- Simplest auth (just PAT header)
- Rate limit: 5 req/sec (use delay)
- Pagination with `offset` parameter

---

### 2. fitbit.py (~715 lines)

**Authentication:** OAuth 2.0 with refresh token

**Script Structure:**
```
fitbit.py
├── Types (OAuth2Credentials, TokenResponse, FitbitApiSleepLog, etc.)
├── Rate Limiter Class
│   └── RateLimiter (150 req/hour tracking)
├── Authentication
│   ├── get_access_token(force_refresh?) - OAuth 2.0 with auto-refresh
│   └── refresh_token_from_api() - POST /oauth2/token (Basic Auth)
├── API Client
│   ├── fetch_sleep_data() - GET /1.2/user/-/sleep/date/{start}/{end}.json
│   ├── fetch_heart_rate_data() - GET /1/user/-/activities/heart/date/{start}/{end}.json
│   ├── fetch_hrv_data() - GET /1/user/-/hrv/date/{start}/{end}.json
│   ├── fetch_activity_data() - GET /1/user/-/activities/date/{date}.json (daily)
│   └── fetch_spo2_data() - GET /1/user/-/spo2/date/{date}.json (daily)
├── DB Transformation
│   ├── to_db_sleep()
│   ├── to_db_heart_rate_daily()
│   ├── to_db_hrv_daily()
│   ├── to_db_activity_daily()
│   └── to_db_spo2_daily()
├── DB Write
│   ├── upsert_sleep()
│   ├── upsert_heart_rate_daily()
│   ├── upsert_hrv_daily()
│   ├── upsert_activity_daily()
│   └── upsert_spo2_daily()
└── Main: sync_fitbit(days=3)
```

**Migration Notes:**
- OAuth 2.0 with refresh_token (similar to google_calendar)
- Rate limit: 150 req/hour (need RateLimiter class)
- Multiple data types with different fetch patterns
- JST to UTC conversion needed
- Token refresh uses Basic Auth (client_id:client_secret)

---

### 3. tanita.py (~720 lines)

**Authentication:** OAuth 2.0 with refresh token

**Script Structure:**
```
tanita.py
├── Types (OAuth2Credentials, TokenResponse, TanitaApiMeasurement, etc.)
├── Constants
│   ├── BODY_COMPOSITION_TAG_MAP (6021=weight, 6022=body_fat_percent)
│   └── BLOOD_PRESSURE_TAG_MAP (622E=systolic, 622F=diastolic, 6230=pulse)
├── Helper Functions
│   ├── format_tanita_date() - datetime -> yyyyMMddHHmmss
│   ├── parse_tanita_date() - yyyyMMddHHmm -> ISO8601 UTC
│   └── generate_periods() - split into 90-day chunks
├── Authentication
│   ├── get_access_token() - OAuth 2.0 with 30min threshold
│   └── refresh_token_from_api() - POST /oauth/token
├── API Client
│   ├── _parse_api_response() - Handle Shift_JIS encoding
│   ├── _extract_measurements() - Extract from nested response
│   ├── fetch_body_composition() - GET /status/innerscan.json
│   └── fetch_blood_pressure() - GET /status/sphygmomanometer.json
├── DB Transformation
│   ├── to_db_body_composition() - Group by date, map tags to fields
│   └── to_db_blood_pressure()
├── DB Write
│   ├── upsert_body_composition()
│   └── upsert_blood_pressure()
└── Main: sync_tanita(days=3)
```

**Migration Notes:**
- OAuth 2.0 with refresh_token
- **IMPORTANT:** API may return Shift_JIS encoding (need special handling)
- API limitation: 3 months per request (need period splitting)
- Tag-based response format (multiple measurements per date)
- Token expiry: access_token 3h, refresh_token 60d

---

### 4. ticktick.py (~500 lines)

**Authentication:** OAuth 2.0 with refresh token

**Script Structure:**
```
ticktick.py
├── Types (OAuth2Credentials, TickTickProject, TickTickTask, etc.)
├── Authentication
│   ├── get_access_token(force_refresh?) - OAuth 2.0 with auto-refresh
│   └── refresh_access_token() - POST /oauth/token
├── API Client
│   ├── fetch_projects() - GET /project
│   ├── fetch_project_tasks() - GET /project/{id}/data
│   └── fetch_completed_tasks() - GET /project/{id}/completed
├── DB Transformation
│   ├── to_db_project()
│   └── to_db_task()
├── DB Write
│   ├── upsert_projects()
│   ├── upsert_tasks()
│   └── upsert_completed_tasks()
└── Main: sync_ticktick(days=7)
```

**Migration Notes:**
- OAuth 2.0 with refresh_token (standard flow)
- Two tables for tasks: active and completed
- Nested project -> tasks structure
- Date format: YYYY-MM-DDTHH:mm:ss+0000

---

### 5. trello.py (~980 lines)

**Authentication:** API Key + Token (OAuth 1.0 style but simpler)

**Script Structure:**
```
trello.py
├── Types (TrelloBoard, TrelloList, TrelloLabel, TrelloCard, TrelloAction, etc.)
├── Authentication
│   ├── get_auth_params() - {key, token} from vault
│   └── get_member_id()
├── API Client
│   ├── fetch_boards() - GET /members/{id}/boards
│   ├── fetch_lists_for_board() - GET /boards/{id}/lists
│   ├── fetch_labels_for_board() - GET /boards/{id}/labels
│   ├── fetch_cards_for_board() - GET /boards/{id}/cards
│   ├── fetch_actions_for_board() - GET /boards/{id}/actions
│   ├── fetch_checklists_for_board() - GET /boards/{id}/checklists
│   ├── fetch_custom_fields_for_board() - GET /boards/{id}/customFields
│   ├── fetch_custom_field_items_for_card() - GET /cards/{id}/customFieldItems
│   ├── fetch_board_data() - Parallel fetch all board data
│   └── fetch_all_data() - Main orchestrator
├── DB Transformation
│   ├── to_db_board(), to_db_list(), to_db_label()
│   ├── to_db_card(), to_db_action()
│   ├── to_db_checklist(), to_db_checkitem()
│   └── to_db_custom_field(), to_db_custom_field_item()
├── DB Write (8 upsert functions)
├── Sync State
│   └── get_last_action_date() - For incremental sync
└── Main: sync_trello(full_sync=False)
```

**Migration Notes:**
- API Key + Token auth (not OAuth flow, just query params)
- Complex nested structure (boards -> lists/labels/cards -> checklists/custom_fields)
- Incremental sync support (actions since last sync)
- Many entity types (9 tables)
- Parallel fetching for performance

---

### 6. zaim.py (~740 lines)

**Authentication:** OAuth 1.0a (HMAC-SHA1 signature)

**Script Structure:**
```
zaim.py
├── Types (ZaimApiTransaction, ZaimApiCategory, etc.)
├── OAuth 1.0a Implementation
│   ├── load_credentials() - Get OAuth 1.0a credentials
│   ├── generate_oauth_signature() - HMAC-SHA1 signature generation
│   └── build_oauth_header() - Construct Authorization header
├── API Client
│   ├── api_get() - OAuth 1.0a signed GET request
│   └── fetch_all_data() - Fetch user, categories, genres, accounts, transactions
├── DB Transformation
│   ├── convert_zaim_timestamp_to_utc() - JST -> UTC
│   ├── to_db_category(), to_db_genre(), to_db_account()
│   └── to_db_transaction()
├── DB Write
│   ├── upsert_categories() - Must be first (FK constraint)
│   ├── upsert_genres() - After categories
│   ├── upsert_accounts()
│   └── upsert_transactions()
└── Main: sync_zaim(days=7)
```

**Migration Notes:**
- **IMPORTANT:** OAuth 1.0a with HMAC-SHA1 signature
  - Requires: consumer_key, consumer_secret, access_token, access_token_secret
  - Signature base string construction
  - Parameter encoding (percent-encoding)
  - HMAC-SHA1 signing
- JST timestamps without timezone info -> UTC conversion
- Foreign key order: categories -> genres -> accounts -> transactions
- Pagination with page/limit params
- Transfer transactions need both from/to account_id

---

## Common Migration Patterns

### OAuth 2.0 Services (fitbit, tanita, ticktick)
```typescript
// lib/oauth2.ts
export async function getOAuth2Token(
  service: string,
  tokenUrl: string,
  thresholdMinutes: number = 60
): Promise<string> {
  // 1. Check cache
  // 2. Load from vault
  // 3. Check expiry
  // 4. Refresh if needed
  // 5. Update vault
  // 6. Return token
}
```

### OAuth 1.0a Services (zaim)
```typescript
// lib/oauth1.ts
export function generateOAuth1Signature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  // 1. Sort and encode params
  // 2. Build base string
  // 3. Create signing key
  // 4. HMAC-SHA1 sign
  // 5. Base64 encode
}

export function buildOAuth1Header(
  method: string,
  url: string,
  credentials: OAuth1Credentials,
  queryParams?: Record<string, string>
): string {
  // Build Authorization: OAuth ... header
}
```

### API Key Services (trello, airtable)
```typescript
// Simple Bearer token or query params
```

---

## Priority Order

1. **airtable** - Simplest (PAT auth)
2. **ticktick** - Standard OAuth 2.0
3. **trello** - API Key auth, but complex data model
4. **fitbit** - OAuth 2.0 + rate limiting
5. **tanita** - OAuth 2.0 + Shift_JIS handling
6. **zaim** - OAuth 1.0a (most complex auth)

---

## Shared TypeScript Modules to Create

```
packages/connector/src/
├── lib/
│   ├── credentials-vault.ts  (from credentials_vault.py)
│   ├── logger.ts             (from logger.py)
│   ├── db.ts                 (from db.py)
│   ├── oauth2.ts             (new - shared OAuth 2.0 logic)
│   └── oauth1.ts             (new - OAuth 1.0a for zaim)
├── db/
│   └── raw-client.ts         (from raw_client.py)
└── services/
    ├── toggl-track/          (migrated)
    ├── google-calendar/      (migrated)
    └── ... (remaining services)
```
