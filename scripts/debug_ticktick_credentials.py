#!/usr/bin/env python3
"""TickTick認証情報のデバッグ"""

import os
import sys
import asyncio

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.credentials import get_credentials


async def main():
    print("=== TickTick credentials check ===\n")

    try:
        result = await get_credentials("ticktick")
        creds = result["credentials"]
        expires = result["expires_at"]

        print("Credential keys:")
        for key in creds.keys():
            value = creds[key]
            if value and len(str(value)) > 20:
                print(f"  {key}: {str(value)[:20]}...")
            else:
                print(f"  {key}: {value}")

        print(f"\nExpires at: {expires}")

        # Required field check
        print("\nRequired field check:")
        print(f"  client_id: {'OK' if creds.get('client_id') else 'MISSING'}")
        print(f"  client_secret: {'OK' if creds.get('client_secret') else 'MISSING'}")
        print(f"  access_token: {'OK' if creds.get('access_token') else 'MISSING'}")
        print(f"  refresh_token: {'OK' if creds.get('refresh_token') else 'MISSING'}")

    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
