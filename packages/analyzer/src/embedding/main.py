"""Entry point for embedding analyzer."""

import sys

from .config import load_config
from .pipeline import EmbeddingPipeline


def main() -> int:
    print("Embedding Analyzer")
    print("==================")

    config = load_config()
    pipeline = EmbeddingPipeline(config)

    result = pipeline.run()

    print("\nProcessing completed:")
    print(f"  Processed: {result.processed}")
    print(f"  Skipped:   {result.skipped}")

    if result.errors:
        print("\nErrors:")
        for err in result.errors:
            print(f"  - {err}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
