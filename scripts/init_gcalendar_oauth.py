#!/usr/bin/env python3
"""Google Calendar OAuth2 認証フロー初期化スクリプト

OAuth2 Authorization Code Flowを実行し、アクセストークンを取得して
Supabase Vaultに保存する。

必要な環境変数:
  - DIRECT_DATABASE_URL
  - GCALENDAR_CLIENT_ID
  - GCALENDAR_CLIENT_SECRET

使用方法:
  python scripts/init_gcalendar_oauth.py

Google Cloud Console設定:
  1. Google Cloud Consoleでプロジェクトを作成/選択
  2. Google Calendar APIを有効化
  3. OAuth同意画面を設定（External/Testing）
  4. OAuth 2.0クライアントIDを作成（デスクトップアプリ）
  5. client_idとclient_secretを環境変数に設定
"""

import asyncio
import os
import sys
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.credentials_vault import save_credentials

# Google OAuth2 設定
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
REDIRECT_URI = "http://localhost:3000/callback"
SCOPES = "https://www.googleapis.com/auth/calendar.events"


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """OAuth2コールバックを受け取るHTTPハンドラー"""

    authorization_code = None

    def do_GET(self):
        """GETリクエストを処理"""
        parsed = urlparse(self.path)

        if parsed.path == "/callback":
            query = parse_qs(parsed.query)

            if "code" in query:
                OAuthCallbackHandler.authorization_code = query["code"][0]
                self.send_response(200)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    b"<html><body><h1>OK!</h1>"
                    b"<p>Google Calendar authorization successful. You can close this window.</p>"
                    b"</body></html>"
                )
            elif "error" in query:
                error = query.get("error", ["unknown"])[0]
                error_description = query.get("error_description", [""])[0]
                self.send_response(400)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    f"<html><body><h1>Error</h1>"
                    f"<p>{error}: {error_description}</p>"
                    f"</body></html>".encode()
                )
            else:
                self.send_response(400)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(
                    b"<html><body><h1>Error</h1><p>No code received</p></body></html>"
                )
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """ログ出力を抑制"""
        pass


def get_authorization_code(client_id: str) -> str:
    """ブラウザで認証画面を開き、認証コードを取得"""
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    print("\n1. ブラウザで認証画面を開きます...")
    print(f"   URL: {auth_url}")

    webbrowser.open(auth_url)

    print("\n2. ブラウザでGoogleアカウントを選択し、アクセスを許可してください...")
    print(f"   コールバックを待機中: {REDIRECT_URI}")

    server = HTTPServer(("localhost", 3000), OAuthCallbackHandler)
    server.handle_request()

    if OAuthCallbackHandler.authorization_code:
        print("\n3. 認証コードを取得しました！")
        return OAuthCallbackHandler.authorization_code
    else:
        raise RuntimeError("認証コードを取得できませんでした")


def exchange_code_for_token(client_id: str, client_secret: str, code: str) -> dict:
    """認証コードをアクセストークンに交換"""
    print("\n4. アクセストークンを取得中...")

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    }

    response = httpx.post(
        GOOGLE_TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    if response.status_code != 200:
        print(f"   Error: {response.status_code}")
        print(f"   Response: {response.text}")
        raise RuntimeError(f"トークン取得に失敗: {response.status_code}")

    token_data = response.json()
    print("   アクセストークンを取得しました！")

    if "refresh_token" not in token_data:
        print("   警告: refresh_tokenが含まれていません。")
        print("   既にこのアプリを認証済みの場合、Googleアカウントの設定からアプリの連携を解除して再試行してください。")

    return token_data


def get_calendar_id_from_user() -> str:
    """ユーザーからカレンダーIDを取得"""
    print("\n5. カレンダーIDを入力してください")
    print("   - 'primary' でプライマリカレンダーを使用")
    print("   - または 'xxxxx@group.calendar.google.com' の形式でカレンダーIDを入力")
    print("   （Google Calendarの設定 > カレンダーの統合 > カレンダーID で確認できます）")

    calendar_id = input("\n   Calendar ID: ").strip()

    if not calendar_id:
        calendar_id = "primary"
        print("   → 'primary' を使用します")

    return calendar_id


async def save_credentials_to_vault(client_id: str, client_secret: str, token_data: dict, calendar_id: str):
    """認証情報をSupabase Vaultに保存"""
    print("\n6. 認証情報をVaultに保存中...")

    credentials = {
        "client_id": client_id,
        "client_secret": client_secret,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", ""),
        "token_type": token_data.get("token_type", "Bearer"),
        "scope": token_data.get("scope", SCOPES),
        "calendar_id": calendar_id,
    }

    if not credentials["refresh_token"]:
        print("   警告: refresh_tokenがありません。トークンの有効期限が切れると再認証が必要です。")

    # expires_in から expires_at を計算
    expires_at = None
    if "expires_in" in token_data:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])

    await save_credentials(
        service="gcalendar",
        credentials=credentials,
        auth_type="oauth2",
        expires_at=expires_at,
        description="Google Calendar OAuth2 credentials"
    )

    print("   認証情報をVaultに保存しました！")
    if expires_at:
        print(f"   有効期限: {expires_at.isoformat()}")


def main():
    """メイン処理"""
    print("=== Google Calendar OAuth2 認証セットアップ ===\n")

    # 環境変数チェック
    client_id = os.environ.get("GCALENDAR_CLIENT_ID")
    client_secret = os.environ.get("GCALENDAR_CLIENT_SECRET")

    if not client_id:
        print("エラー: GCALENDAR_CLIENT_ID 環境変数が設定されていません")
        print("\nGoogle Cloud Consoleで設定してください:")
        print("  1. https://console.cloud.google.com/apis/credentials")
        print("  2. OAuth 2.0 クライアントID を作成（デスクトップアプリ）")
        print("  3. クライアントIDを .env に設定: GCALENDAR_CLIENT_ID=xxx")
        sys.exit(1)

    if not client_secret:
        print("エラー: GCALENDAR_CLIENT_SECRET 環境変数が設定されていません")
        print("\nGoogle Cloud Consoleで取得したclient_secretを .env に設定してください:")
        print("  GCALENDAR_CLIENT_SECRET=xxx")
        sys.exit(1)

    print(f"Client ID: {client_id[:8]}...{client_id[-4:]}")
    print(f"Redirect URI: {REDIRECT_URI}")
    print(f"Scopes: {SCOPES}")

    try:
        # 1. 認証コードを取得
        code = get_authorization_code(client_id)

        # 2. トークンを取得
        token_data = exchange_code_for_token(client_id, client_secret, code)

        # 3. カレンダーIDを取得
        calendar_id = get_calendar_id_from_user()

        # 4. Vaultに保存
        asyncio.run(save_credentials_to_vault(client_id, client_secret, token_data, calendar_id))

        print("\n" + "=" * 50)
        print("Google Calendar OAuth2 認証が完了しました！")
        print("=" * 50)
        print("\n次のステップ:")
        print("  python -c \"import asyncio; from pipelines.services.gcalendar import sync_gcalendar; asyncio.run(sync_gcalendar(days=3))\"")

    except Exception as e:
        print(f"\nエラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
