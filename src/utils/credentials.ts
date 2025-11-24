/**
 * 認証情報の暗号化・復号・DB管理
 *
 * AES-256-GCM を使用して認証情報を暗号化し、
 * credentials.services テーブルに保存・取得する
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64, decodeBase64 } from "jsr:@std/encoding/base64";

// =============================================================================
// Types
// =============================================================================

/** 認証方式 */
export type AuthType =
  | "oauth2"          // Fitbit, Tanita
  | "oauth1"          // Zaim
  | "basic"           // Toggl (API Token)
  | "api_key"         // Notion
  | "service_account" // Google Calendar
  | "supabase";       // Supabase

/** サービス識別子 */
export type ServiceId =
  | "fitbit"
  | "tanita"
  | "toggl"
  | "zaim"
  | "gcalendar"
  | "notion"
  | "supabase";

/** OAuth2 認証情報 */
export interface OAuth2Credentials {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  redirect_uri?: string;
  scope?: string;
  user_id?: string;
}

/** OAuth1 認証情報 */
export interface OAuth1Credentials {
  consumer_key: string;
  consumer_secret: string;
  access_token: string;
  access_token_secret: string;
}

/** Basic認証/API Token */
export interface BasicCredentials {
  api_token: string;
  workspace_id?: string;
  user_id?: string;
}

/** API Key 認証情報 */
export interface ApiKeyCredentials {
  api_key: string;
  metadata_table_id?: string;
}

/** Service Account 認証情報 */
export interface ServiceAccountCredentials {
  service_account_json: string;  // Base64 encoded JSON
  calendar_id?: string;
}

/** Supabase 認証情報（参考用、実際はDBアクセスに必須なので環境変数から） */
export interface SupabaseCredentials {
  url: string;
  service_role_key: string;
  db_password?: string;
}

/** 認証情報の共用型 */
export type Credentials =
  | OAuth2Credentials
  | OAuth1Credentials
  | BasicCredentials
  | ApiKeyCredentials
  | ServiceAccountCredentials
  | SupabaseCredentials;

// =============================================================================
// Encryption Key
// =============================================================================

let _encryptionKey: CryptoKey | null = null;

/**
 * 暗号化キーを取得（環境変数から）
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  if (_encryptionKey) return _encryptionKey;

  const keyBase64 = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!keyBase64) {
    throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
  }

  const keyBytes = decodeBase64(keyBase64);
  if (keyBytes.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (256 bits) base64 encoded");
  }

  _encryptionKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );

  return _encryptionKey;
}

/**
 * 新しい暗号化キーを生成（初回セットアップ用）
 */
export function generateEncryptionKey(): string {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeBase64(keyBytes);
}

// =============================================================================
// Encryption / Decryption
// =============================================================================

/**
 * 認証情報を暗号化
 * nonce(12バイト) + ciphertext の形式で返す
 */
export async function encryptCredentials(
  credentials: Credentials
): Promise<Uint8Array> {
  const key = await getEncryptionKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12)); // 96 bits
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext
  );

  // nonce + ciphertext を連結
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

/**
 * 認証情報を復号
 * nonce(12バイト) + ciphertext の形式を想定
 */
export async function decryptCredentials<T extends Credentials>(
  data: Uint8Array
): Promise<T> {
  const key = await getEncryptionKey();
  
  // 先頭12バイトがnonce
  const nonce = data.slice(0, 12);
  const ciphertext = data.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertext
  );

  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as T;
}

// =============================================================================
// Supabase Client
// =============================================================================

let _supabase: SupabaseClient | null = null;

/**
 * Supabaseクライアントを取得
 */
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  _supabase = createClient(url, key);
  return _supabase;
}

/**
 * 接続を閉じる（Supabase Clientは特に必要ないが、互換性のため残す）
 */
export async function closeSql(): Promise<void> {
  _supabase = null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Uint8Arrayをbytea用のhex文字列に変換
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * byteaのhex文字列をUint8Arrayに変換
 * Supabaseはbyteaを "\\x..." 形式で返す
 */
function hexToUint8Array(hex: string): Uint8Array {
  // "\\x" プレフィックスを除去
  const cleanHex = hex.startsWith("\\x") ? hex.slice(2) : hex;
  
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * 認証情報を保存（upsert）
 */
export async function saveCredentials(
  service: ServiceId,
  authType: AuthType,
  credentials: Credentials,
  expiresAt?: Date
): Promise<void> {
  const supabase = getSupabase();
  const encrypted = await encryptCredentials(credentials);

  const { error } = await supabase
    .schema("credentials")
    .from("services")
    .upsert({
      service,
      auth_type: authType,
      credentials_encrypted: uint8ArrayToHex(encrypted),
      expires_at: expiresAt?.toISOString() ?? null,
    }, { onConflict: "service" });

  if (error) {
    throw new Error(`Failed to save credentials for ${service}: ${error.message}`);
  }
}

/**
 * 認証情報を取得
 */
export async function getCredentials<T extends Credentials>(
  service: ServiceId
): Promise<{ credentials: T; expiresAt: Date | null } | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .schema("credentials")
    .from("services")
    .select("credentials_encrypted, expires_at")
    .eq("service", service)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw new Error(`Failed to get credentials for ${service}: ${error.message}`);
  }

  const encrypted = hexToUint8Array(data.credentials_encrypted);
  const credentials = await decryptCredentials<T>(encrypted);

  return {
    credentials,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  };
}

/**
 * 認証情報を更新（OAuth2 トークンリフレッシュ用）
 */
export async function updateCredentials(
  service: ServiceId,
  credentials: Partial<Credentials>,
  expiresAt?: Date
): Promise<void> {
  // 既存の認証情報を取得
  const existing = await getCredentials(service);
  if (!existing) {
    throw new Error(`Credentials not found for ${service}`);
  }

  // マージして保存
  const merged = { ...existing.credentials, ...credentials };
  const encrypted = await encryptCredentials(merged as Credentials);

  const supabase = getSupabase();

  const { error } = await supabase
    .schema("credentials")
    .from("services")
    .update({
      credentials_encrypted: uint8ArrayToHex(encrypted),
      expires_at: expiresAt?.toISOString() ?? existing.expiresAt?.toISOString() ?? null,
    })
    .eq("service", service);

  if (error) {
    throw new Error(`Failed to update credentials for ${service}: ${error.message}`);
  }
}

/**
 * expires_at のみ更新
 */
export async function updateExpiresAt(
  service: ServiceId,
  expiresAt: Date
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .schema("credentials")
    .from("services")
    .update({ expires_at: expiresAt.toISOString() })
    .eq("service", service);

  if (error) {
    throw new Error(`Failed to update expires_at for ${service}: ${error.message}`);
  }
}

/**
 * 全サービスの認証情報一覧を取得（暗号化されたまま）
 */
export async function listServices(): Promise<{ service: ServiceId; authType: AuthType; expiresAt: Date | null }[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .schema("credentials")
    .from("services")
    .select("service, auth_type, expires_at")
    .order("service");

  if (error) {
    throw new Error(`Failed to list services: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    service: row.service as ServiceId,
    authType: row.auth_type as AuthType,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
  }));
}

// =============================================================================
// CLI Entry Point (for testing)
// =============================================================================

if (import.meta.main) {
  console.log("Generate new encryption key:");
  console.log(generateEncryptionKey());
}
