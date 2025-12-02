---
title: 認証・セキュリティ設計
---

## 初回セットアップフロー

```
┌─────────────────────────────────────────────────────────────┐
│  1. Supabaseプロジェクト作成（ブラウザで数クリック）           │
│     → URL + SERVICE_ROLE_KEY を取得                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Vercelデプロイ                                          │
│     → 環境変数4つ設定（DIRECT_DATABASE_URL追加）             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. 初回アクセス                                             │
│     → マイグレーション自動実行                               │
│     → メールアドレス入力画面                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Magic Link送信 → メールのリンクをクリック                 │
│     → メール確認完了                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  5. パスワード設定画面                                       │
│     → パスワードを登録                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  6. 初回ユーザー = オーナーとして自動登録                     │
│     → ダッシュボードへ                                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  7. （オプション）GitHub PAT入力                             │
│     → Actions dispatch、使用量表示が有効に                  │
└─────────────────────────────────────────────────────────────┘
```

**ユーザーがやること**: Supabase作成 → Vercelデプロイ → メール確認 → パスワード設定

**GitHub OAuth App作成は不要です。**

---

## オーナー認証

### メール + パスワード方式

| 項目 | 説明 |
|------|------|
| 認証方式 | メール + パスワード |
| 初回のみ | Magic Linkでメール確認 → パスワード設定 |
| 2回目以降 | メール + パスワードでログイン |
| パスワード忘れ | Magic Linkでリセット |
| 識別子 | メールアドレス |
| Supabase設定 | デフォルトで有効（追加設定不要） |

### ログインフロー

**初回セットアップ**:
```
メール入力 → Magic Link送信 → リンククリック
→ パスワード設定 → オーナー登録 → ダッシュボード
```

**2回目以降**:
```
メール + パスワード入力 → ログイン → ダッシュボード
```

**パスワード忘れ**:
```
「パスワードを忘れた」クリック → Magic Link送信
→ リンククリック → 新パスワード設定 → ダッシュボード
```

### オーナー判定ロジック

1. 初回アクセス時、`profiles` テーブルに `setup_completed=true` のオーナーがいるかチェック
2. いなければ「セットアップ画面」を表示
3. メールアドレス入力 → Magic Link送信
4. リンククリック → `auth.users` に登録 → トリガーで `profiles` 作成（`is_owner=true`, `setup_completed=false`）
5. パスワード設定画面を表示
6. パスワード登録 → `setup_completed=true` に更新
7. 以降のログイン時、`profiles` に存在するユーザーのみ許可

### データベース構造

```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  is_owner BOOLEAN DEFAULT FALSE,
  setup_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- auth.users 作成時に自動で profiles を作成
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## GitHub連携（オプション）

### 概要

GitHub連携はオプション機能です。基本的なサービス連携管理・同期ログ確認は連携なしで動作します。

### 機能比較

| 機能 | GitHub連携なし | GitHub連携あり |
|------|:-------------:|:-------------:|
| サービス連携管理 | ✅ | ✅ |
| 同期ログ確認 | ✅ | ✅ |
| 手動同期実行 | ❌ | ✅ |
| Actions使用量表示 | ❌ | ✅ |
| 自動実行トグル | ❌ | ✅ |

### GitHub PAT

オーナー認証後、ダッシュボードの設定画面でPATを入力します。

**必要なスコープ（Fine-grained PAT推奨）**:
- `Actions`: Read and write（dispatch用）
- `Metadata`: Read-only（リポジトリ情報取得用）

**Classic PATの場合**:
- `repo`（プライベートリポジトリの場合）
- `workflow`

### PAT vs OAuth App

| 項目 | OAuth App | PAT |
|------|-----------|-----|
| 事前準備 | App作成 + Callback URL設定 | GitHubで生成するだけ |
| Supabase設定 | Provider設定必要 | 不要 |
| スコープ制御 | 固定 | Fine-grained PATで細かく制御可能 |

**PATを採用した理由**: セットアップの簡略化

### PAT管理

| 項目 | 内容 |
|------|------|
| 入力タイミング | オーナー認証後（オプション） |
| 保存場所 | Supabase Vault |
| 有効期限 | PAT設定に依存（Fine-grained: 最大1年、Classic: 無期限可） |
| 無効化時 | 再入力で更新 |

---

## 認証情報の保存

### Supabase Vault

| 項目 | 説明 |
|------|------|
| 保存先 | `vault.secrets` テーブル |
| 暗号化 | Supabase管理のマスターキーによる透過的暗号化 |
| 読み取り | `vault.decrypted_secrets` ビュー経由で自動復号 |
| アクセス方法 | 直接DB接続（`DIRECT_DATABASE_URL`）経由のみ |

**メリット**:
- 暗号化キーの管理不要
- バックアップ・レプリケーション時も暗号化維持
- フォーク後の設定作業ゼロ

**注意**: PostgREST経由ではVaultにアクセスできないため、`psycopg2`（Python）または`postgres`（Node.js）で直接DB接続が必要。

### 保存形式

```json
// vault.secrets.secret の構造
{
  "api_token": "xxx...",      // 認証情報
  "client_id": "xxx...",
  "_auth_type": "api_key",    // メタデータ: 認証方式
  "_expires_at": null         // メタデータ: 有効期限
}
```

---

## 認証方式一覧

| サービス | 認証方式 | 保存する認証情報 | 必須フィールド |
|---------|---------|----------------|--------------|
| Toggl | Basic Auth | api_token | api_token |
| Trello | API Key + Token | api_key, api_token | api_key, api_token |
| Airtable | Personal Access Token | personal_access_token | personal_access_token |
| Google Calendar | OAuth 2.0 | client_id/secret, access/refresh_token | - |
| Zaim | OAuth 1.0a | consumer_key/secret, access_token/secret | - |
| Fitbit | OAuth 2.0 | client_id/secret, access/refresh_token | - |
| Tanita | OAuth 2.0 | client_id/secret, access/refresh_token | - |
| TickTick | OAuth 2.0 | client_id/secret, access/refresh_token | - |
| GitHub | Personal Access Token | pat | - |

### API Key サービスの自動取得

- **Toggl**: `workspace_id` は API（`/me`）から自動取得
- **Trello**: 全ボードを自動取得（`board_id` の指定不要）

---

## トークンリフレッシュ

| サービス | 有効期限 | 閾値 | 戦略 |
|---------|---------|------|------|
| GitHub | PAT設定依存 | - | 期限切れ時に再入力 |
| Fitbit | 8時間 | 60分前 | 自動リフレッシュ |
| Tanita | 3時間 | 30分前 | 自動リフレッシュ |
| TickTick | 6時間 | 30分前 | 自動リフレッシュ |
| Google Calendar | 1時間 | 5分前 | 自動リフレッシュ |
| Toggl | なし | - | 不要 |
| Zaim | なし | - | 不要（OAuth 1.0a） |
| Trello | なし | - | 不要（永続トークン） |
| Airtable | なし | - | 不要（PAT） |

---

## 環境変数

### Vercel / サーバーレス関数

```bash
# Supabase接続（必須）
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Vault直接接続（必須）
DIRECT_DATABASE_URL=postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
```

**注意**: `DIRECT_DATABASE_URL` はPooler（`pooler.supabase.com`）ではなく、直接接続（`db.[ref].supabase.co`）を使用すること。

### GitHub Actions

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DIRECT_DATABASE_URL=postgresql://...
```

**Supabase Dashboard設定**: 追加設定不要（メール認証はデフォルト有効）

---

## セキュリティ注意事項

1. **Service Role Key**:
   - RLSをバイパスできる強力な権限
   - サーバーサイド（API Routes）のみで使用
   - GitHub Secretsに保存
   - ローカル開発でも`.env`をgitignore

2. **DIRECT_DATABASE_URL**:
   - Vault操作に必要な直接接続文字列
   - パスワードを含むため厳重に管理
   - GitHub Secrets / Vercel環境変数に保存

3. **パスワード**:
   - Supabase Authが安全にハッシュ化して保存
   - 平文では保存されない

4. **OAuth トークン**:
   - refresh_token は長期間有効
   - access_token 漏洩時はrefreshで無効化可能

5. **Supabase Vault**:
   - マスターキーはSupabaseが管理
   - DBバックアップ時も暗号化維持
   - 復号には `vault.decrypted_secrets` ビューを使用

6. **GitHub PAT**:
   - Fine-grained PATで最小権限を推奨
   - Vault内に暗号化保存
   - 期限切れ前に更新を促す通知（将来実装）

7. **Magic Link**:
   - メール送信はSupabaseが管理
   - リンクの有効期限はSupabase設定に依存（デフォルト1時間）
   - 初回セットアップとパスワードリセット時のみ使用

8. **Next.js Proxy（旧Middleware）**:
   - Next.js 16でmiddleware → proxyに移行
   - 認証チェックはServer ComponentまたはAPI Routesで行う
   - proxyはセッション更新とリダイレクトのみに使用

---

## 関連ドキュメント

- [管理ダッシュボード設計](admin-dashboard)
- [DWH 4層アーキテクチャ](dwh-layers)
- [リリース戦略](release-strategy)

---

*最終更新: 2025-12-02*
