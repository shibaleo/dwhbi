#!/usr/bin/env python3
"""Run dbt with environment variables loaded from .env file.

Usage:
    python scripts/run_dbt.py debug
    python scripts/run_dbt.py run
    python scripts/run_dbt.py test
    python scripts/run_dbt.py run --select staging.toggl_track
"""

import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv


def main() -> None:
    """Load .env and run dbt command."""
    # Set UTF-8 encoding for Windows
    os.environ["PYTHONUTF8"] = "1"

    # Load .env file
    project_root = Path(__file__).parent.parent
    load_dotenv(project_root / ".env")

    # Parse DIRECT_DATABASE_URL if DBT_* vars not set
    if not os.getenv("DBT_SUPABASE_HOST"):
        from urllib.parse import urlparse

        database_url = os.getenv("DIRECT_DATABASE_URL")
        if database_url:
            parsed = urlparse(database_url)
            os.environ["DBT_SUPABASE_HOST"] = parsed.hostname or ""
            os.environ["DBT_SUPABASE_PORT"] = str(parsed.port or 5432)
            os.environ["DBT_SUPABASE_USER"] = parsed.username or "postgres"
            os.environ["DBT_SUPABASE_PASSWORD"] = parsed.password or ""
            os.environ["DBT_SUPABASE_DB"] = parsed.path.lstrip("/") or "postgres"

    # Get dbt command from arguments
    if len(sys.argv) < 2:
        print("Usage: python scripts/run_dbt.py <dbt_command> [args...]")
        print("Example: python scripts/run_dbt.py run")
        sys.exit(1)

    dbt_args = sys.argv[1:]

    # Run dbt from transform directory
    transform_dir = project_root / "transform"

    print(f"Running: dbt {' '.join(dbt_args)}")
    print(f"Host: {os.environ.get('DBT_SUPABASE_HOST')}")

    result = subprocess.run(
        ["dbt"] + dbt_args,
        cwd=transform_dir,
        env=os.environ,
    )

    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
