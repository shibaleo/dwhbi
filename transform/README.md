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
