/**
 * Google Calendar サービスアカウント認証
 * 
 * サービスアカウントのJWTを使用してアクセストークンを取得する。
 * トークンは1時間有効で、都度取得する設計（キャッシュなし）。
 */

import {
  ServiceAccountCredentials,
  TokenResponse,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

// =============================================================================
// Credential Loading
// =============================================================================

/**
 * 環境変数からサービスアカウントのcredentialを取得
 * Base64エンコードまたは生JSONに対応
 */
export function loadCredentials(): ServiceAccountCredentials {
  const credentialEnv = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!credentialEnv) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set");
  }

  let jsonStr: string;
  
  // Base64かどうかを判定（{で始まらない場合はBase64とみなす）
  if (credentialEnv.trim().startsWith("{")) {
    jsonStr = credentialEnv;
  } else {
    // Base64デコード
    try {
      jsonStr = atob(credentialEnv);
    } catch {
      throw new Error("Failed to decode GOOGLE_SERVICE_ACCOUNT_JSON as Base64");
    }
  }

  try {
    const credentials = JSON.parse(jsonStr) as ServiceAccountCredentials;
    
    // 必須フィールドの検証
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Invalid credentials: missing client_email or private_key");
    }
    
    return credentials;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON as JSON");
    }
    throw e;
  }
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
  
  const credentials = loadCredentials();
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
