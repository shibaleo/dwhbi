# supabase-sync-dwh Transform Layer

dbt project for transforming raw data into staging, core, and marts layers.

## Quick Start

```bash
# Install dbt (included in requirements.txt)
pip install -r requirements.txt

# Setup dbt environment variables from DIRECT_DATABASE_URL
# Bash:
eval $(python scripts/setup_dbt_env.py)

# PowerShell:
python scripts/setup_dbt_env.py --powershell | Invoke-Expression

# Install dbt dependencies
cd transform
dbt deps

# Test connection
dbt debug

# Run models
dbt run

# Run tests
dbt test
```

## Environment Variables

This project uses `DIRECT_DATABASE_URL` to configure database connection.

| Variable | Description | Example |
|----------|-------------|---------|
| `DIRECT_DATABASE_URL` | PostgreSQL connection URL | `postgresql://postgres:password@db.xxx.supabase.co:5432/postgres` |

The `scripts/setup_dbt_env.py` script parses this URL and sets:
- `DBT_SUPABASE_HOST`
- `DBT_SUPABASE_PORT`
- `DBT_SUPABASE_USER`
- `DBT_SUPABASE_PASSWORD`
- `DBT_SUPABASE_DB`

## Project Structure

```
transform/
├── models/
│   ├── staging/          # raw → staging transformation
│   │   └── toggl_track/  # Toggl Track models
│   ├── core/             # Business entities (future)
│   └── marts/            # Analytics views (future)
├── macros/               # Custom macros
├── seeds/                # Static reference data
├── snapshots/            # SCD Type 2 snapshots
├── tests/                # Custom tests
├── dbt_project.yml       # Project configuration
├── packages.yml          # Dependencies
└── profiles.yml          # Connection profiles
```

## Layer Design

| Layer | Schema | Purpose |
|-------|--------|---------|
| raw | `raw` | API responses (JSONB) |
| staging | `staging` | Type conversion, normalization |
| core | `core` | Business entities |
| marts | `marts` | Analytics views |

## Naming Conventions

- **Sources**: `{service}__{entity}` (e.g., `toggl_track__time_entries`)
- **Staging**: `stg_{service}__{entity}` (e.g., `stg_toggl_track__time_entries`)
- **Core**: `{entity}` (e.g., `time_entries`)
- **Marts**: `{domain}_{entity}` (e.g., `productivity_daily_summary`)

## Staging Models

### Toggl Track

| Model | Description |
|-------|-------------|
| `stg_toggl_track__time_entries` | Time entries from API v9 |
| `stg_toggl_track__time_entries_report` | Time entries from Reports API v3 |
| `stg_toggl_track__projects` | Projects |
| `stg_toggl_track__clients` | Clients |
| `stg_toggl_track__tags` | Tags |
| `stg_toggl_track__workspaces` | Workspaces |
| `stg_toggl_track__users` | Workspace users |
| `stg_toggl_track__me` | Current user profile |
| `stg_toggl_track__groups` | Workspace groups |

## Data Cleanup Log

### 2025-12-14: Deleted duplicate/orphan Toggl entries

以下のエントリーをDBから削除した。後で詳しく調査が必要。

#### 削除理由: Toggl側に存在しない孤立レコード
| source_id | 日付 (JST) | 説明 | 備考 |
|-----------|------------|------|------|
| 4214801695 | 2025-12-12 12:57 - 2025-12-14 (現在時刻) | Work | 2.5日間実行中のまま。Toggl側では削除済み |
| undefined | - | - | Reports API同期時に混入した不正レコード（idがnull） |

#### 削除理由: 同一start_atの重複エントリー（止め忘れと判断）

前後のエントリーとの整合性から、以下を「止め忘れ」と判断して削除:

| source_id | 日付 (JST) | 時間 | カテゴリ | 説明 | 削除理由 |
|-----------|------------|------|----------|------|----------|
| 4118251638 | 2025-10-01 | 19:57:23 - 20:43:00 | Pleasure | movie | 次のエントリー(20:10:18開始)と重複。残したID 4118230591 (20:10:18終了) と繋がる |
| 4117656951 | 2025-10-01 | 12:00:25 - 12:16:55 | Vitals | lunch | 次のエントリー(12:06:00開始)と重複。残したID 4117649118 (12:06:00終了) と繋がる |
| 3747875908 | 2025-01-05 | 09:31:00 - 09:58:00 | Vitals | breakfast | 次のエントリー(09:38:24開始)と重複。残したID 3747875866 (09:38:24終了) と繋がる |
| 3743494184 | 2024-12-30 | 12:32:40 - 12:55:21 | Vitals | lunch | 次のエントリー(13:02:35開始)と重複。残したID 3743499627 (13:02:35終了) と繋がる |
| 3699658291 | 2024-11-22 | 12:00:40 - 12:26:20 | Education | 管理 | 次のエントリー(dinner 18:06:00開始)と重複。残したID 3699931721 (18:06:31終了 work) と繋がる |
| 3590730458 | 2024-09-04 | 07:35:00 - 12:03:31 | Work | work | 次のエントリー(08:56:00開始)と重複。残したID 3590730215 (08:56:00終了 breakfast) と繋がる |
| 3417906237 | 2024-04-23 | 12:16:00 - 12:17:00 | Education | 財計 | 1分の短いエントリー。残したID 3425073630 (12:55:00終了) が妥当 |
| 3737601579 | 2024-12-20 | 17:38:31 - 17:38:31 | Education | 財理 | 0秒のエントリー。次のエントリー(bath 22:00:00開始)。残したID 3737663226 (21:59:00終了 work) と繋がる |
