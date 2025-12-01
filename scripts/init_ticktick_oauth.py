#!/usr/bin/env python3
"""TickTick OAuth2 認証フロー初期化スクリプト

OAuth2 Authorization Code Flowを実行し、アクセストークンを取得して
credentials.servicesに保存する。

必要な環境変数:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - TOKEN_ENCRYPTION_KEY
  - TICKTICK_CLIENT_ID
  - TICKTICK_CLIENT_SECRET

使用方法:
  python scripts/init_ticktick_oauth.py
"""

import os
import sys
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse, urlencode
import httpx

from dotenv import load_dotenv

# .envファイルを読み込む
load_dotenv()

# プロジェクトルートをパスに追加
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.lib.db import get_supabase_client
from pipelines.lib.encryption import encrypt_credentials

# TickTick OAuth2 設定
TICKTICK_AUTH_URL = "https://ticktick.com/oauth/authorize"
TICKTICK_TOKEN_URL = "https://ticktick.com/oauth/token"
REDIRECT_URI = "http://localhost:8765/callback"
SCOPES = "tasks:read tasks:write"


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
                    b"<p>Authorization code received. You can close this window.</p>"
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
    # 認証URLを構築
    # access_type=offline を追加してrefresh_tokenを取得
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
    }
    auth_url = f"{TICKTICK_AUTH_URL}?{urlencode(params)}"

    print("\n1. ブラウザで認証画面を開きます...")
    print(f"   URL: {auth_url}")

    # ブラウザを開く
    webbrowser.open(auth_url)

    # ローカルサーバーでコールバックを待つ
    print("\n2. ブラウザで認証を許可してください...")
    print(f"   コールバックを待機中: {REDIRECT_URI}")

    server = HTTPServer(("localhost", 8765), OAuthCallbackHandler)
    server.handle_request()  # 1リクエストだけ処理

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
        "scope": SCOPES,
    }

    response = httpx.post(
        TICKTICK_TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    if response.status_code != 200:
        print(f"   Error: {response.status_code}")
        print(f"   Response: {response.text}")
        raise RuntimeError(f"トークン取得に失敗: {response.status_code}")

    token_data = response.json()
    print("   アクセストークンを取得しました！")
    return token_data


def save_credentials(client_id: str, client_secret: str, token_data: dict):
    """認証情報をSupabaseに保存"""
    print("\n5. 認証情報を保存中...")

    # 保存する認証情報
    credentials = {
        "client_id": client_id,
        "client_secret": client_secret,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", ""),
        "token_type": token_data.get("token_type", "Bearer"),
        "scope": token_data.get("scope", SCOPES),
    }

    # 暗号化
    encrypted = encrypt_credentials(credentials)
    encrypted_hex = "\\x" + encrypted.hex()

    # expires_in から expires_at を計算
    expires_at = None
    if "expires_in" in token_data:
        from datetime import datetime, timedelta, timezone

        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])
        ).isoformat()

    # Supabaseに保存
    supabase = get_supabase_client()
    result = (
        supabase.schema("credentials")
        .table("services")
        .upsert(
            {
                "service": "ticktick",
                "auth_type": "oauth2",
                "credentials_encrypted": encrypted_hex,
                "expires_at": expires_at,
            },
            on_conflict="service",
        )
        .execute()
    )

    if result.data:
        print("   認証情報を保存しました！")
        if expires_at:
            print(f"   有効期限: {expires_at}")
    else:
        raise RuntimeError("認証情報の保存に失敗")


def main():
    """メイン処理"""
    print("=== TickTick OAuth2 認証セットアップ ===\n")

    # 環境変数チェック
    client_id = os.environ.get("TICKTICK_CLIENT_ID")
    client_secret = os.environ.get("TICKTICK_CLIENT_SECRET")

    if not client_id:
        print("エラー: TICKTICK_CLIENT_ID 環境変数が設定されていません")
        sys.exit(1)

    if not client_secret:
        print("エラー: TICKTICK_CLIENT_SECRET 環境変数が設定されていません")
        sys.exit(1)

    print(f"Client ID: {client_id[:8]}...{client_id[-4:]}")
    print(f"Redirect URI: {REDIRECT_URI}")
    print(f"Scopes: {SCOPES}")

    try:
        # 1. 認証コードを取得
        code = get_authorization_code(client_id)

        # 2. トークンを取得
        token_data = exchange_code_for_token(client_id, client_secret, code)

        # 3. 保存
        save_credentials(client_id, client_secret, token_data)

        print("\n" + "=" * 50)
        print("TickTick OAuth2 認証が完了しました！")
        print("=" * 50)

    except Exception as e:
        print(f"\nエラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
