#!/usr/bin/env python3
"""Setup dbt environment variables from DIRECT_DATABASE_URL.

Usage:
    # Print export commands (for shell eval)
    python scripts/setup_dbt_env.py

    # In bash:
    eval $(python scripts/setup_dbt_env.py)

    # In PowerShell:
    python scripts/setup_dbt_env.py --powershell | Invoke-Expression
"""

import os
import sys
from urllib.parse import urlparse

from dotenv import load_dotenv


def parse_database_url(url: str) -> dict[str, str]:
    """Parse DATABASE_URL into components.

    Args:
        url: PostgreSQL connection URL
             Format: postgresql://user:password@host:port/dbname

    Returns:
        Dictionary with host, port, user, password, dbname
    """
    parsed = urlparse(url)

    return {
        "host": parsed.hostname or "",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "dbname": parsed.path.lstrip("/") or "postgres",
    }


def main() -> None:
    """Parse DIRECT_DATABASE_URL and print export commands."""
    # Load .env file
    load_dotenv()

    database_url = os.getenv("DIRECT_DATABASE_URL")
    if not database_url:
        print("Error: DIRECT_DATABASE_URL is not set", file=sys.stderr)
        sys.exit(1)

    components = parse_database_url(database_url)

    # Check for PowerShell flag
    use_powershell = "--powershell" in sys.argv or "-p" in sys.argv

    if use_powershell:
        # PowerShell format
        print(f'$env:DBT_SUPABASE_HOST="{components["host"]}"')
        print(f'$env:DBT_SUPABASE_PORT="{components["port"]}"')
        print(f'$env:DBT_SUPABASE_USER="{components["user"]}"')
        print(f'$env:DBT_SUPABASE_PASSWORD="{components["password"]}"')
        print(f'$env:DBT_SUPABASE_DB="{components["dbname"]}"')
    else:
        # Bash format
        print(f'export DBT_SUPABASE_HOST="{components["host"]}"')
        print(f'export DBT_SUPABASE_PORT="{components["port"]}"')
        print(f'export DBT_SUPABASE_USER="{components["user"]}"')
        print(f'export DBT_SUPABASE_PASSWORD="{components["password"]}"')
        print(f'export DBT_SUPABASE_DB="{components["dbname"]}"')


if __name__ == "__main__":
    main()
