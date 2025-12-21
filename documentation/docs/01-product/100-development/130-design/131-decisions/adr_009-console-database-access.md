---
title: ADR-009 Console データベースアクセス方式の変更
description: Direct DB URL から Supabase API 経由への移行計画
status: 提案中
date: 2024-12-21
---

# ADR-009: Console データベースアクセス方式の変更

## ステータス

提案中

## コンテキスト

console（Next.js）を Vercel にデプロイするにあたり、環境変数の整理を行った。現状、以下の4つの環境変数が必要である:

| 環境変数 | 用途 |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 接続（クライアント/サーバー） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名キー |
| `SUPABASE_SERVICE_ROLE_KEY` | 管理者権限操作（setup API） |
| `DIRECT_DATABASE_URL` | PostgreSQL 直接接続（vault.ts, patterns.ts） |

### 現状の問題

#### 1. `DIRECT_DATABASE_URL` のセキュリティリスク

`vault.ts` と `patterns.ts` では、`postgres` ライブラリを使用して PostgreSQL に直接接続している。

```typescript
// vault.ts, patterns.ts
function getDbConnection() {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  return postgres(connectionString);
}
```

**リスク:**
- DB 接続文字列が漏洩すると、**RLS を完全にバイパス**して全データにアクセス可能
- Vercel の環境変数は設定ミス、ログ出力、ビルドログなどで漏洩するリスクがある
- 接続文字列には DB パスワードが含まれており、最も強力な認証情報

#### 2. 最小権限の原則に反している

現在のアクセスパターン:
- `vault.decrypted_secrets` の読み書き → **全テーブルへのアクセス権限を持つ接続で実行**
- `console.*` テーブルの操作 → **同上**

本来必要な権限は限定的だが、全権限を持つ接続を使用している。

#### 3. 環境変数の管理コスト

4つの環境変数を Vercel で管理する必要があり、特に `DIRECT_DATABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は機密性が高い。

## 検討した選択肢

### 選択肢 A: 現状維持（Direct DB URL）

**メリット:**
- コード変更不要
- Supabase 側の設定変更不要

**デメリット:**
- 全権限キーを Vercel に配置
- RLS がバイパスされる
- 漏洩時の影響が甚大

### 選択肢 B: Supabase API 経由 + RLS（採用）

**メリット:**
- RLS による行レベルアクセス制御
- `ANON_KEY` は公開前提なので漏洩しても影響が限定的
- 多層防御（キー漏洩時も RLS が最終防衛線）
- API ログによる監査性

**デメリット:**
- Supabase 側の設定変更が必要
- コード変更が必要
- vault スキーマは RPC 関数経由でのアクセスが必要

### 選択肢 C: Service Role Key のみで統一

**メリット:**
- 環境変数が減る（3つ）
- コード変更は比較的少ない

**デメリット:**
- Service Role Key は RLS をバイパスするため、本質的な解決にならない
- 強力な権限を持つキーを減らせない

## 決定

**選択肢 B: Supabase API 経由 + RLS** を採用する。

### 変更によるメリット

1. **セキュリティ向上**
   - 最小権限の原則に従ったアクセス制御
   - RLS による多層防御
   - 万が一キーが漏洩しても被害を限定可能

2. **環境変数の大幅削減**
   - `DIRECT_DATABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を削除（4 → 2）
   - 機密性の高いキーを全て排除
   - 残る環境変数は公開前提の `NEXT_PUBLIC_*` のみ

3. **監査性の向上**
   - Supabase API 経由のアクセスはログに記録される
   - 不正アクセスの検知が容易

### 変更によるデメリット

1. **Supabase 設定の複雑化**
   - `console` スキーマを API に公開する設定が必要
   - RLS ポリシーの設計・実装が必要
   - vault アクセス用の RPC 関数作成が必要

2. **コード変更**
   - `vault.ts` と `patterns.ts` の書き換え
   - postgres ライブラリから Supabase クライアントへの移行
   - setup API の修正（Service Role Key 依存の排除）

3. **パフォーマンス**
   - 直接 DB 接続より若干遅くなる可能性（実用上は問題なし）

## 実装計画

### Phase 1: Supabase 設定

#### 1.1 console スキーマを API に公開

```sql
-- Supabase Dashboard > SQL Editor で実行
ALTER SCHEMA console OWNER TO postgres;

-- API に公開（PostgREST が認識できるようにする）
GRANT USAGE ON SCHEMA console TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA console TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA console TO anon, authenticated;

-- 今後作成されるテーブルにも適用
ALTER DEFAULT PRIVILEGES IN SCHEMA console
  GRANT ALL ON TABLES TO anon, authenticated;
```

#### 1.2 RLS ポリシーの設定

```sql
-- time_intent_pattern_groups テーブル
ALTER TABLE console.time_intent_pattern_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
  ON console.time_intent_pattern_groups
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- time_intent_pattern_versions テーブル
ALTER TABLE console.time_intent_pattern_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
  ON console.time_intent_pattern_versions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

#### 1.3 vault アクセス用 RPC 関数

vault スキーマは直接 API に公開すべきではないため、必要な操作のみを RPC 関数として公開する。

```sql
-- シークレット取得（認証済みユーザーのみ）
CREATE OR REPLACE FUNCTION console.get_service_secret(service_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, console, public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT decrypted_secret::jsonb INTO result
  FROM vault.decrypted_secrets
  WHERE name = service_name;

  RETURN result;
END;
$$;

-- シークレット保存
CREATE OR REPLACE FUNCTION console.upsert_service_secret(
  service_name TEXT,
  secret_data JSONB,
  secret_description TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, console, public
AS $$
DECLARE
  existing_id UUID;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = service_name;

  IF existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(
      existing_id,
      secret_data::text,
      service_name,
      COALESCE(secret_description, service_name || ' credentials')
    );
  ELSE
    PERFORM vault.create_secret(
      secret_data::text,
      service_name,
      COALESCE(secret_description, service_name || ' credentials')
    );
  END IF;
END;
$$;

-- シークレット削除
CREATE OR REPLACE FUNCTION console.delete_service_secret(service_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, console, public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = service_name;
END;
$$;

-- 全サービスのシークレット取得
CREATE OR REPLACE FUNCTION console.get_all_service_secrets(service_names TEXT[])
RETURNS TABLE(name TEXT, decrypted_secret JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, console, public
AS $$
BEGIN
  RETURN QUERY
  SELECT ds.name::TEXT, ds.decrypted_secret::jsonb
  FROM vault.decrypted_secrets ds
  WHERE ds.name = ANY(service_names);
END;
$$;

-- RPC 関数へのアクセス権限
GRANT EXECUTE ON FUNCTION console.get_service_secret TO authenticated;
GRANT EXECUTE ON FUNCTION console.upsert_service_secret TO authenticated;
GRANT EXECUTE ON FUNCTION console.delete_service_secret TO authenticated;
GRANT EXECUTE ON FUNCTION console.get_all_service_secrets TO authenticated;
```

### Phase 2: コード変更

#### 2.1 patterns.ts の修正

```typescript
// Before: postgres ライブラリ
import postgres from "postgres";

function getDbConnection() {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  return postgres(connectionString);
}

// After: Supabase クライアント
import { createClient } from "@/lib/supabase/server";

export async function getAllPatterns(): Promise<PatternInfo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_intent_pattern_groups")
    .select(`
      id,
      name,
      description,
      created_at,
      updated_at,
      time_intent_pattern_versions!inner (
        version_number,
        content_hash,
        valid_from,
        message,
        entries
      )
    `)
    .is("deleted_at", null)
    .is("time_intent_pattern_versions.valid_to", null)
    .order("name");

  // ... データ変換処理
}
```

#### 2.2 vault.ts の修正

```typescript
// Before: postgres ライブラリ
const rows = await sql`
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ${service}
`;

// After: Supabase RPC
import { createClient } from "@/lib/supabase/server";

export async function getServiceCredentials(service: ServiceName) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("get_service_secret", { service_name: service });

  if (error || !data) return null;

  const { _auth_type, _expires_at, ...credentials } = data;
  return credentials;
}
```

### Phase 3: SUPABASE_SERVICE_ROLE_KEY の削除

setup API で使用している `SUPABASE_SERVICE_ROLE_KEY` を削除し、RLS ポリシーで対応する。

#### 3.1 profiles テーブルの RLS 設定

```sql
-- profiles テーブルの RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 自分自身のプロファイルを読み取り可能
CREATE POLICY "Users can read own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 自分自身のプロファイルを更新可能
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 初回登録時に自分自身のプロファイルを作成可能
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);
```

#### 3.2 初回オーナー設定の対応

初回セットアップ時の `is_owner = true` 設定は、以下のいずれかで対応:

**案 A: データベーストリガー（採用）**
```sql
-- 最初のユーザーを自動的にオーナーにするトリガー
CREATE OR REPLACE FUNCTION public.handle_first_user_as_owner()
RETURNS TRIGGER AS $$
BEGIN
  -- 既存のオーナーがいなければ、このユーザーをオーナーにする
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_owner = true) THEN
    NEW.is_owner := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_first_user_as_owner();
```

**案 B: セットアップ完了チェックの変更**
- `is_owner` フラグを廃止し、単に「認証済みユーザー = オーナー」として扱う
- シングルテナント前提なら、認証できた時点でオーナーとみなせる

#### 3.3 setup API の修正

```typescript
// Before: Service Role Key を使用
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // 削除対象
);

// After: 通常の認証済みクライアントを使用
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS により自分自身のプロファイルのみ更新可能
  const { error } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email,
      setup_completed: true,
    });

  // ...
}
```

### Phase 4: 環境変数の更新

1. Vercel から `DIRECT_DATABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を削除
2. ローカル開発用 `.env` を更新（不要な変数を削除）
3. ドキュメントの更新

### 最終的な環境変数

| 環境変数 | 用途 | 機密性 |
|----------|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 接続 | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名キー | 公開可 |

## テスト計画

1. **ユニットテスト**: RPC 関数の動作確認
2. **統合テスト**: 認証済みユーザーでの CRUD 操作
3. **セキュリティテスト**: 未認証ユーザーでのアクセス拒否確認
4. **本番確認**: Vercel デプロイ後の動作確認

## 結論

`DIRECT_DATABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を排除し、Supabase API + RLS 経由のアクセスに移行する。

これにより:
- 環境変数を 4 → 2 に削減
- 機密性の高いキーを全て排除（残るのは公開前提の `NEXT_PUBLIC_*` のみ）
- RLS による多層防御でセキュリティを向上

vault スキーマへのアクセスは RPC 関数でラップし、必要最小限の操作のみを公開することで、機密情報の保護と利便性を両立する。

## 関連ドキュメント

- [ADR-007 インフラストラクチャ配置](/01-product/100-development/130-design/131-decisions/adr_007-infrastructure-layout)
- [ADR-008 サーバー間通信セキュリティ設計](/01-product/100-development/130-design/131-decisions/adr_008-server-communication-security)
