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
│     → 環境変数3つ設定                                       │
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

1. 初回アクセス時、`allowed_users` テーブルが空かチェック
2. 空なら「セットアップ画面」を表示
3. メールアドレス入力 → Magic Link送信
4. リンククリック → メール確認完了
5. パスワード設定画面を表示
6. パスワード登録 → 初回ユーザーをオーナーとして `allowed_users` に登録
7. 以降のログイン時、`allowed_users` に存在するメールのみ許可

### 未登録ユーザーの処理

```
メール入力 → allowed_users確認 →
  登録済み → ログイン処理
  未登録 → 「このメールは登録されていません」表示
```

### データベース構造

```sql
CREATE TABLE allowed_users (
  email TEXT PRIMARY KEY,
  is_owner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
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

## マイグレーション自動実行

### 概要

初回アクセス時に、API Routeからマイグレーションを自動実行します。

### 実行条件

1. `app_config` テーブルが存在しない、または `migration_complete` が `false`
2. `SERVICE_ROLE_KEY` が設定されている

### 実行内容

```
/api/setup/migrate
  → Supabase SQL実行（SERVICE_ROLE_KEY使用）
  → 全テーブル作成（raw, app_config, allowed_users, sync_logs）
  → app_config.migration_complete = 'true' を設定
```

### セキュリティ

- SERVICE_ROLE_KEY はサーバーサイドのみで使用
- 初回のみ実行（migration_complete フラグで制御）
- マイグレーション完了後は再実行不可

---

## 認証情報の保存

### Supabase Vault

| 項目 | 説明 |
|------|------|
| 保存先 | `vault.secrets` テーブル |
| 暗号化 | Supabase管理のマスターキーによる透過的暗号化 |
| 読み取り | `vault.decrypted_secrets` ビュー経由で自動復号 |

**メリット**:
- 暗号化キーの管理不要
- バックアップ・レプリケーション時も暗号化維持
- フォーク後の設定作業ゼロ

### 保存形式

```
vault.secrets
├── name: サービス識別子（例: "fitbit", "toggl", "github"）
├── secret: JSON形式の認証情報（暗号化済み）
└── description: サービス説明（任意）
```

---

## 認証方式一覧

| サービス | 認証方式 | 保存する認証情報 |
|---------|---------|----------------|
| GitHub | Personal Access Token | pat |
| Toggl | Basic Auth | api_token, workspace_id |
| Google Calendar | OAuth 2.0 | client_id/secret, access/refresh_token, calendar_id |
| Zaim | OAuth 1.0a | consumer_key/secret, access_token/secret |
| Fitbit | OAuth 2.0 | client_id/secret, access/refresh_token |
| Tanita | OAuth 2.0 | client_id/secret, access/refresh_token |
| Trello | API Key + Token | api_key, api_token, board_id |
| TickTick | OAuth 2.0 | client_id/secret, access/refresh_token |
| Airtable | Personal Access Token | personal_access_token, base_id, table_ids |

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

```bash
# Supabase接続（必須）
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Supabase Dashboard設定**: 追加設定不要（メール認証はデフォルト有効）

---

## セキュリティ注意事項

1. **Service Role Key**:
   - RLSをバイパスできる強力な権限
   - サーバーサイド（API Routes）のみで使用
   - GitHub Secretsに保存
   - ローカル開発でも`.env`をgitignore

2. **パスワード**:
   - Supabase Authが安全にハッシュ化して保存
   - 平文では保存されない

3. **OAuth トークン**:
   - refresh_token は長期間有効
   - access_token 漏洩時はrefreshで無効化可能

4. **Supabase Vault**:
   - マスターキーはSupabaseが管理
   - DBバックアップ時も暗号化維持
   - 復号には `vault.decrypted_secrets` ビューを使用

5. **GitHub PAT**:
   - Fine-grained PATで最小権限を推奨
   - Vault内に暗号化保存
   - 期限切れ前に更新を促す通知（将来実装）

6. **Magic Link**:
   - メール送信はSupabaseが管理
   - リンクの有効期限はSupabase設定に依存（デフォルト1時間）
   - 初回セットアップとパスワードリセット時のみ使用

---

## 関連ドキュメント

- [管理ダッシュボード設計](admin-dashboard)
- [DWH 4層アーキテクチャ](dwh-layers)
- [リリース戦略](release-strategy)

---

*最終更新: 2025-12-02*
