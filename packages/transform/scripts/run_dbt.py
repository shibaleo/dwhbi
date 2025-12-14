#!/usr/bin/env python3
"""Run dbt with environment variables loaded from .env file.

Usage:
    python packages/transform/scripts/run_dbt.py debug
    python packages/transform/scripts/run_dbt.py run
    python packages/transform/scripts/run_dbt.py test
    python packages/transform/scripts/run_dbt.py run --select staging.toggl_track
    python packages/transform/scripts/run_dbt.py deploy  # run + test + docs generate + copy to console
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv


def setup_env() -> tuple[Path, Path]:
    """Setup environment variables and return paths."""
    # Set UTF-8 encoding for Windows
    os.environ["PYTHONUTF8"] = "1"

    # Get directory paths
    script_dir = Path(__file__).parent
    transform_dir = script_dir.parent
    project_root = transform_dir.parent.parent

    # Load .env file from project root
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

    return transform_dir, project_root


def run_dbt(transform_dir: Path, args: list[str]) -> int:
    """Run dbt command and return exit code."""
    print(f"\n{'='*60}")
    print(f"Running: dbt {' '.join(args)}")
    print(f"{'='*60}")

    result = subprocess.run(
        [sys.executable, "-m", "dbt.cli.main"] + args,
        cwd=transform_dir,
        env=os.environ,
    )
    return result.returncode


def copy_docs_to_console(transform_dir: Path, project_root: Path) -> None:
    """Copy dbt docs to console public folder."""
    source_dir = transform_dir / "target"
    dest_dir = project_root / "packages" / "console" / "public" / "dbt-docs"

    # Files to copy
    files = ["index.html", "catalog.json", "manifest.json"]

    print(f"\n{'='*60}")
    print("Copying dbt docs to console...")
    print(f"{'='*60}")

    # Create destination directory
    dest_dir.mkdir(parents=True, exist_ok=True)

    for filename in files:
        src = source_dir / filename
        dst = dest_dir / filename
        if src.exists():
            shutil.copy2(src, dst)
            print(f"  Copied: {filename}")
        else:
            print(f"  Warning: {filename} not found")

    # Add console navigation button to index.html
    index_path = dest_dir / "index.html"
    if index_path.exists():
        content = index_path.read_text(encoding="utf-8")
        if "console-nav-btn" not in content:
            button_html = (
                '<style>.console-nav-btn{position:fixed;bottom:24px;left:24px;'
                'display:flex;align-items:center;gap:8px;background:#18181b;'
                'color:white;padding:12px 16px;border-radius:9999px;'
                'box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);text-decoration:none;'
                'font-family:system-ui,-apple-system,sans-serif;font-weight:500;'
                'z-index:9999;transition:background 0.2s}'
                '.console-nav-btn:hover{background:#3f3f46;color:white}</style>'
                '<a href="/" class="console-nav-btn">'
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" '
                'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                'stroke-linecap="round" stroke-linejoin="round">'
                '<rect x="3" y="3" width="7" height="7"></rect>'
                '<rect x="14" y="3" width="7" height="7"></rect>'
                '<rect x="14" y="14" width="7" height="7"></rect>'
                '<rect x="3" y="14" width="7" height="7"></rect>'
                '</svg><span>Console</span></a>'
            )
            content = content.replace("</body>", button_html + "</body>")
            index_path.write_text(content, encoding="utf-8")
            print("  Added: Console navigation button")

    print(f"\nDocs available at: /dbt-docs/index.html")


def deploy(transform_dir: Path, project_root: Path) -> int:
    """Run dbt run, test, docs generate, and copy to console."""
    print(f"Host: {os.environ.get('DBT_SUPABASE_HOST')}")

    # Step 1: dbt run
    code = run_dbt(transform_dir, ["run"])
    if code != 0:
        print("\n[ERROR] dbt run failed")
        return code

    # Step 2: dbt test
    code = run_dbt(transform_dir, ["test"])
    if code != 0:
        print("\n[ERROR] dbt test failed")
        return code

    # Step 3: dbt docs generate
    code = run_dbt(transform_dir, ["docs", "generate"])
    if code != 0:
        print("\n[ERROR] dbt docs generate failed")
        return code

    # Step 4: Copy docs to console
    copy_docs_to_console(transform_dir, project_root)

    print(f"\n{'='*60}")
    print("Deploy completed successfully!")
    print(f"{'='*60}")
    return 0


def main() -> None:
    """Load .env and run dbt command."""
    transform_dir, project_root = setup_env()

    # Get dbt command from arguments
    if len(sys.argv) < 2:
        print("Usage: python packages/transform/scripts/run_dbt.py <command> [args...]")
        print("")
        print("Commands:")
        print("  deploy              Run + Test + Docs Generate + Copy to Console")
        print("  run [args]          Run dbt run")
        print("  test [args]         Run dbt test")
        print("  docs generate       Generate documentation")
        print("  <any dbt command>   Pass through to dbt")
        sys.exit(1)

    # Handle deploy command
    if sys.argv[1] == "deploy":
        sys.exit(deploy(transform_dir, project_root))

    # Pass through to dbt
    dbt_args = sys.argv[1:]
    print(f"Host: {os.environ.get('DBT_SUPABASE_HOST')}")
    sys.exit(run_dbt(transform_dir, dbt_args))


if __name__ == "__main__":
    main()
