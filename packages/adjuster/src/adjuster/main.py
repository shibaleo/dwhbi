"""Main entry point for adjuster."""

import argparse
from datetime import date


def main() -> None:
    """Run the adjuster."""
    parser = argparse.ArgumentParser(description="Adjustment proposal generator")
    parser.add_argument(
        "--date",
        type=str,
        default=str(date.today()),
        help="Target date (YYYY-MM-DD)",
    )
    args = parser.parse_args()

    print(f"Running adjuster for date: {args.date}")
    # TODO: Implement adjuster logic


if __name__ == "__main__":
    main()
