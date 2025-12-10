---
title: 認証・セキュリティ仕様
description: 認証方式と認証情報の保護に関する仕様
---

# 認証・セキュリティ仕様

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

## 認証情報の保存

### Supabase Vault

| 項目 | 説明 |
|------|------|
| 保存先 | `vault.secrets` テーブル |
| 暗号化方式 | AEAD（Authenticated Encryption with Associated Data） |
| 暗号化 | Supabase管理のマスターキーによる透過的暗号化 |
| 読み取り | `vault.decrypted_secrets` ビュー経由で自動復号 |
| アクセス方法 | 直接DB接続（`DIRECT_DATABASE_URL`）経由のみ |

AEADは暗号化と認証を同時に行う方式で、データの機密性と完全性を保証する。Supabase Vaultはpgsodiumを使用してAEADを実現している。

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

## 認証方式一覧

| サービス | 認証方式 | 保存する認証情報 |
|---------|---------|----------------|
| Toggl Track | Basic Auth | api_token |
| Trello | API Key + Token | api_key, api_token |
| Airtable | Personal Access Token | personal_access_token |
| Google Calendar | OAuth 2.0 | client_id/secret, access/refresh_token |
| Zaim | OAuth 1.0a | consumer_key/secret, access_token/secret |
| Fitbit | OAuth 2.0 | client_id/secret, access/refresh_token |
| Tanita Health Planet | OAuth 2.0 | client_id/secret, access/refresh_token |
| TickTick | OAuth 2.0 | client_id/secret, access/refresh_token |
| GitHub | Personal Access Token | pat |

### API Key サービスの自動取得

- **Toggl Track**: `workspace_id` は API（`/me`）から自動取得
- **Trello**: 全ボードを自動取得（`board_id` の指定不要）

## トークンリフレッシュ

| サービス | 有効期限 | 閾値 | 戦略 |
|---------|---------|------|------|
| GitHub | PAT設定依存 | - | 期限切れ時に再入力 |
| Fitbit | 8時間 | 60分前 | 自動リフレッシュ |
| Tanita Health Planet | 3時間 | 30分前 | 自動リフレッシュ |
| TickTick | 6時間 | 30分前 | 自動リフレッシュ |
| Google Calendar | 1時間 | 5分前 | 自動リフレッシュ |
| Toggl Track | なし | - | 不要 |
| Zaim | なし | - | 不要（OAuth 1.0a） |
| Trello | なし | - | 不要（永続トークン） |
| Airtable | なし | - | 不要（PAT） |

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

## アクセス制御

| リソース | 制御方法 |
|---------|---------|
| ダッシュボード全体 | メール + パスワード認証必須 |
| ログイン許可 | profiles テーブルでユーザー照合 |
| API Routes | セッション検証 |
| Vault | Service Role Key経由のみアクセス |

## 通信の暗号化

### Vercel採用の理由

管理コンソールはVercelでホストする。理由は通信の暗号化（HTTPS）を容易に実現するため。

| ホスト方式 | HTTPS対応 | 証明書管理 | 運用負荷 |
|-----------|----------|-----------|---------|
| Vercel | 自動 | 不要 | 最小 |
| クラウドVM | 手動設定 | Let's Encrypt等 + 自動更新設定 | 高 |

クラウドVMでHTTPSを実現するにはドメイン取得、証明書取得（Let's Encrypt等）、Nginx設定、証明書自動更新の設定が必要となり、個人プロジェクトには過剰な運用負荷となる。Vercelを使用することで、HTTPS化と証明書管理が自動化され、運用工数を最小限に抑えられる。
