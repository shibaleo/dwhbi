/**
 * Google Calendar サービスアカウント認証
 * 
 * サービスアカウントのJWTを使用してアクセストークンを取得する。
 * 認証情報は credentials.services テーブルから取得。
 * トークンは1時間有効で、メモリキャッシュ付き。
 */

import "jsr:@std/dotenv/load";
import {
  ServiceAccountCredentials,
  TokenResponse,
} from "./types.ts";
import {
  getCredentials,
  type ServiceAccountCredentials as CredServiceAccountCredentials,
} from "../../utils/credentials.ts";

// =============================================================================
// Constants
// =============================================================================

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

// =============================================================================
// Credential Loading
// =============================================================================

let _credentials: ServiceAccountCredentials | null = null;
let _calendarId: string | null = null;

/**
 * credentials.services からサービスアカウントのcredentialを取得（キャッシュ付き）
 */
export async function loadCredentials(): Promise<ServiceAccountCredentials> {
  if (_credentials) return _credentials;

  const result = await getCredentials<CredServiceAccountCredentials>("gcalendar");
  if (!result) {
    throw new Error("GCalendar credentials not found in credentials.services");
  }

  const { credentials } = result;
  if (!credentials.service_account_json) {
    throw new Error("GCalendar credentials missing service_account_json");
  }

  // calendar_idをキャッシュ
  _calendarId = credentials.calendar_id || null;

  // Base64デコードまたは生JSONをパース
  let jsonStr: string;
  const jsonData = credentials.service_account_json;

  if (jsonData.trim().startsWith("{")) {
    jsonStr = jsonData;
  } else {
    try {
      jsonStr = atob(jsonData);
    } catch {
      throw new Error("Failed to decode service_account_json as Base64");
    }
  }

  try {
    _credentials = JSON.parse(jsonStr) as ServiceAccountCredentials;
    
    if (!_credentials.client_email || !_credentials.private_key) {
      throw new Error("Invalid credentials: missing client_email or private_key");
    }
    
    return _credentials;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("Failed to parse service_account_json as JSON");
    }
    throw e;
  }
}

/**
 * カレンダーIDを取得
 */
export async function getCalendarId(): Promise<string | null> {
  await loadCredentials(); // キャッシュをロード
  return _calendarId;
}

// =============================================================================
// JWT Generation
// =============================================================================

/**
 * Base64URL エンコード
 */
function base64UrlEncode(data: Uint8Array | string): string {
  const str = typeof data === "string" 
    ? btoa(data) 
    : btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * PEM形式の秘密鍵をCryptoKeyに変換
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // PEMヘッダー/フッターを除去してBase64デコード
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  return await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

/**
 * JWTを生成
 */
async function createJwt(credentials: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  
  const payload = {
    iss: credentials.client_email,
    scope: SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  
  // 署名
  const privateKey = await importPrivateKey(credentials.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  
  return `${signingInput}.${encodedSignature}`;
}

// =============================================================================
// Token Exchange
// =============================================================================

/**
 * JWTをアクセストークンに交換
 */
async function exchangeJwtForToken(jwt: string): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange JWT for token: ${response.status} ${errorText}`);
  }
  
  return await response.json() as TokenResponse;
}

// =============================================================================
// Public API
// =============================================================================

// =============================================================================
// Token Cache
// =============================================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * アクセストークンを取得（キャッシュ付き）
 * トークンは有効期限の5分前まで再利用
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  
  // キャッシュが有効なら再利用（5分のマージン）
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedToken.token;
  }
  
  const credentials = await loadCredentials();
  const jwt = await createJwt(credentials);
  const tokenResponse = await exchangeJwtForToken(jwt);
  
  // キャッシュを更新
  cachedToken = {
    token: tokenResponse.access_token,
    expiresAt: now + tokenResponse.expires_in * 1000,
  };
  
  return cachedToken.token;
}

/**
 * 認証付きfetchラッパー
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getAccessToken();
  
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  
  return fetch(url, {
    ...options,
    headers,
  });
}
