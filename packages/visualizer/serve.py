#!/usr/bin/env python3
"""Serve dbt docs locally.

Usage:
    python packages/visualizer/serve.py

Then open http://localhost:8080 in your browser.
"""

import http.server
import os
import socketserver
import webbrowser
from pathlib import Path

PORT = 8080


def main() -> None:
    """Start HTTP server for dbt docs."""
    docs_dir = Path(__file__).parent / "dbt-docs"
    os.chdir(docs_dir)

    handler = http.server.SimpleHTTPRequestHandler

    with socketserver.TCPServer(("", PORT), handler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"Serving dbt docs at {url}")
        print("Press Ctrl+C to stop")
        webbrowser.open(url)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
