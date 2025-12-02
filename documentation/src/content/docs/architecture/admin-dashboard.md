---
title: 管理ダッシュボード設計
description: 認証情報登録と同期管理のためのWeb UI
---

## 概要

LIFETRACERの管理ダッシュボードは、各サービスの認証情報登録と同期状況の監視を行うWeb UIです。

---

## 設計方針

### 1ユーザー・1設定の原則

LIFETRACERは「個人の生活データを統合」が目的のため、各サービスにつき1つの設定のみをサポートします。

| 項目 | 方針 |
|------|------|
| ワークスペース | 1つのみ |
| ユーザーアカウント | 1つのみ |
| カレンダー | 1つのみ |
| ボード/ベース | 1つのみ |

**理由**:
- スキーマのシンプルさを維持
- テンプレートとしての汎用性
- 複数アカウント統合が必要な場合はサービス側で対応

**UIでの表現**:
- 設定フォームに「1ワークスペースのみ対応」等の注釈を表示
- 複数設定が必要なユースケースは対象外であることを明示

### セットアップの簡略化

GitHub OAuth Appの作成を不要にし、最小限の手順でデプロイできるようにします。

---

## 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| フレームワーク | Next.js (App Router) | Vercel親和性、API Routes |
| ホスティング | Vercel | サーバーレス関数が標準装備 |
| 認証 | Supabase Auth（メール + パスワード） | シンプル、追加設定不要 |
| UI | shadcn/ui + Tailwind CSS | テンプレートとの親和性 |
| シークレット保存 | Supabase Vault | 暗号化キー管理不要 |

### テンプレート

[Vercel公式 Supabase Starter](https://vercel.com/templates/next.js/supabase) をベースに構築

---

## 初回セットアップフロー

```
1. Supabaseプロジェクト作成（ブラウザで数クリック）
   → URL + SERVICE_ROLE_KEY を取得
           ↓
2. Vercelデプロイ
   → 環境変数2つ設定
           ↓
3. 初回アクセス
   → マイグレーション自動実行
   → メールアドレス入力画面
           ↓
4. Magic Link送信 → メールのリンクをクリック
   → メール確認完了
           ↓
5. パスワード設定画面
   → パスワードを登録
           ↓
6. 初回ユーザー = オーナーとして自動登録
   → ダッシュボードへ
           ↓
7. （オプション）GitHub PAT入力
   → Actions dispatch、使用量表示が有効に
```

**ユーザーがやること**: Supabase作成 → Vercelデプロイ → メール確認 → パスワード設定

**GitHub OAuth App作成は不要です。**

---

## オーナー認証

### メール + パスワード方式

| 項目 | 内容 |
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

---

## GitHub連携（オプション）

### 機能比較

| 機能 | GitHub連携なし | GitHub連携あり |
|------|:-------------:|:-------------:|
| サービス連携管理 | ✅ | ✅ |
| 同期ログ確認 | ✅ | ✅ |
| 手動同期実行 | ❌ | ✅ Actions dispatch |
| Actions使用量表示 | ❌ | ✅ |
| 自動実行トグル | ❌ | ✅ |

**基本機能はGitHub連携なしで動作します。**

### GitHub PAT設定

オーナー認証後、ダッシュボードの設定画面でPATを入力：

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub連携 設定                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Personal Access Token                                      │
│  [____________________________________]                     │
│                                                             │
│  必要なスコープ:                                             │
│  ・Fine-grained PAT: Actions (Read and write)              │
│  ・Classic PAT: repo, workflow                              │
│                                                             │
│  [保存]  [連携解除]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### PATの利点

| 項目 | OAuth App | PAT |
|------|-----------|-----|
| 事前準備 | App作成 + Callback URL設定 | GitHubで生成するだけ |
| Supabase設定 | Provider設定必要 | 不要 |
| スコープ制御 | 固定 | Fine-grained PATで細かく制御可能 |

### 必要なPATスコープ

**Fine-grained PAT（推奨）**:
- `Actions`: Read and write（dispatch用）
- `Metadata`: Read-only（リポジトリ情報取得用）

**Classic PAT**:
- `repo`（プライベートリポジトリの場合）
- `workflow`

---

## ダッシュボード画面構成

### メイン画面

```
┌─────────────────────────────────────────────────────────────┐
│  LIFETRACER Dashboard                          [ログアウト]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  GitHub Actions                     [GitHub連携が必要です]   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 今月の使用量: 1,234 / 2,000 分  [██████░░░░] 62%    │   │
│  │ 自動同期: [ON]  毎日 00:00 JST                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  連携サービス                                                │
│  ┌─────────┬─────────┬─────────┬─────────┐                 │
│  │ Toggl   │ Fitbit  │ Zaim    │ GCal    │                 │
│  │ ✅ 連携中│ ✅ 連携中│ ⚠️ 要更新│ ❌ 未設定│                 │
│  │ [設定]  │ [設定]  │ [設定]  │ [設定]  │                 │
│  └─────────┴─────────┴─────────┴─────────┘                 │
│  ┌─────────┬─────────┬─────────┬─────────┐                 │
│  │ Tanita  │ Trello  │ TickTick│ Airtable│                 │
│  │ ✅ 連携中│ ✅ 連携中│ ✅ 連携中│ ✅ 連携中│                 │
│  │ [設定]  │ [設定]  │ [設定]  │ [設定]  │                 │
│  └─────────┴─────────┴─────────┴─────────┘                 │
│                                                             │
│  最終同期結果                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ サービス    最終同期            ステータス   件数     │   │
│  │ Toggl      2025-12-02 00:00    ✅ 成功     152件    │   │
│  │ Fitbit     2025-12-02 00:00    ✅ 成功     8件      │   │
│  │ Zaim       2025-12-01 00:00    ❌ 失敗     -        │   │
│  │            └─ エラー: トークン期限切れ                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  手動同期                          [GitHub連携が必要です]    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 同期日数: [3] 日前から                               │   │
│  │ [同期実行]                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 機能一覧

### サービス連携管理

| 機能 | 説明 | 実装方法 |
|------|------|---------|
| 連携状況表示 | 各サービスの連携状態を表示 | Vault読み取り |
| OAuth連携 | Fitbit, Tanita, TickTick, GCal, Zaim | API Routes でコールバック処理 |
| API Key登録 | Toggl, Trello, Airtable | フォーム入力 → Vault保存 |
| 認証情報更新 | トークン期限切れ時の再認証 | OAuth再実行 |
| 連携解除 | 認証情報の削除 | Vault削除 |

### 同期管理

| 機能 | 説明 | GitHub連携 | 実装方法 |
|------|------|:----------:|---------|
| 最終同期結果 | 各サービスの同期結果表示 | 不要 | sync_logsテーブル参照 |
| 手動同期実行 | 任意のタイミングで同期 | **必要** | GitHub API workflow_dispatch |
| 同期パラメータ設定 | 同期日数等を指定 | **必要** | UIで入力 → dispatch inputs |
| 自動実行トグル | 定期実行のON/OFF切り替え | **必要** | GitHub API workflow enable/disable |
| Actions使用量 | 今月の無料枠消費状況 | **必要** | GitHub API billing |

---

## サービス設定フォーム

### 共通構成

各サービスの設定画面は以下の構成：

```
┌─────────────────────────────────────────────────────────────┐
│  Toggl 設定                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚠️ 1ワークスペースのみ対応しています                         │
│                                                             │
│  API Token                                                  │
│  [____________________________________]                     │
│                                                             │
│  Workspace ID                                               │
│  [____________________________________]                     │
│                                                             │
│  [保存]  [連携解除]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### サービス別設定項目

| サービス | 認証情報 | 固有設定 | 注記 |
|---------|---------|---------|------|
| Toggl | API Token | workspace_id | 1ワークスペースのみ |
| Google Calendar | Client ID/Secret | calendar_id | 1カレンダーのみ |
| Zaim | Consumer Key/Secret | - | 1アカウントのみ |
| Fitbit | Client ID/Secret | - | 1アカウントのみ |
| Tanita | Client ID/Secret | - | 1アカウントのみ |
| Trello | API Key, Token | board_id | 1ボードのみ |
| TickTick | Client ID/Secret | - | 1アカウントのみ |
| Airtable | PAT | base_id, table_ids | 1ベースのみ |

---

## 認証情報登録フロー

### OAuth 2.0 / 1.0a（Fitbit, Tanita, TickTick, Google Calendar, Zaim）

```
1. ダッシュボード → サービスの[設定]をクリック
2. Client ID / Secret + 固有設定の入力フォーム表示
3. 「認証開始」ボタン → 各サービスのOAuth画面へリダイレクト
4. ユーザーが認可
5. Callback URL (/api/callback/[service]) でコード受信
6. API Route でトークン交換
7. 全設定を Vault に保存
8. ダッシュボードにリダイレクト（連携完了表示）
```

### API Key / PAT（Toggl, Trello, Airtable）

```
1. ダッシュボード → サービスの[設定]をクリック
2. API Key / Token + 固有設定の入力フォーム表示
3. 「保存」ボタン
4. API Route で全設定を Vault に保存
5. ダッシュボードに戻る（連携完了表示）
```

---

## エラー通知

### 方針

| 通知方法 | 対応状況 | 備考 |
|---------|:--------:|------|
| ダッシュボード警告 | ✅ 実装 | デフォルト |
| メール通知 | ⏳ 保留 | オプション機能として検討 |
| Slack/Discord連携 | ⏳ 保留 | 実装時はデフォルトON |

### ダッシュボード表示

- 連携サービスカードに警告アイコン（⚠️）を表示
- 最終同期結果にエラー詳細を表示
- トークン期限切れ等は「再認証」ボタンを表示

---

## API Routes 構成

```
/api
├── auth
│   ├── callback             # Supabase Auth コールバック
│   ├── signup               # 初回登録（Magic Link送信）
│   ├── login                # ログイン（メール + パスワード）
│   ├── set-password         # パスワード設定
│   └── reset-password       # パスワードリセット（Magic Link）
├── setup
│   └── migrate              # 初回マイグレーション実行
├── services
│   ├── [service]/connect    # OAuth開始
│   ├── [service]/callback   # OAuthコールバック
│   ├── [service]/save       # 設定保存（API Key + 固有設定）
│   └── [service]/disconnect # 連携解除
├── sync
│   └── status               # 同期結果取得
└── github
    ├── save                 # PAT保存
    ├── actions/usage        # Actions使用量取得
    ├── actions/trigger      # 手動同期実行
    └── workflow/toggle      # 自動実行ON/OFF
```

---

## データベーステーブル

### app_config

初期設定状態の管理

```sql
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 例: 
-- migration_complete = 'true'
-- setup_complete = 'true'
```

### allowed_users

ログイン許可ユーザー（メールで識別）

```sql
CREATE TABLE allowed_users (
  email TEXT PRIMARY KEY,
  is_owner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### sync_logs

同期実行ログ（無期限保持）

```sql
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'success' | 'failed'
  records_count INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**保持ポリシー**: Supabase上では無期限保持。ダッシュボードでの表示件数は別途検討。

---

## 環境変数

### Vercel（必須）

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Supabase Dashboard

**追加設定不要** — メール認証はデフォルトで有効

---

## セキュリティ

### アクセス制御

| リソース | 制御方法 |
|---------|---------|
| ダッシュボード全体 | メール + パスワード認証必須 |
| ログイン許可 | allowed_users テーブルでメール照合 |
| API Routes | セッション検証 |
| Vault | Service Role Key経由のみアクセス |

### 認証情報の保護

- すべての認証情報は Supabase Vault に暗号化保存
- OAuth Client ID/Secret もフォーム入力 → Vault保存
- GitHub PAT も Vault に保存
- クライアントサイドにシークレットは露出しない
- API Routes（サーバーサイド）でのみVaultにアクセス

### GitHub PAT の管理

| 項目 | 内容 |
|------|------|
| 入力タイミング | オーナー認証後（オプション） |
| 保存場所 | Supabase Vault |
| 有効期限 | PAT設定に依存 |
| 権限スコープ | Actions (Read and write) |
| 無効化時 | 再入力で更新 |

---

## 関連ドキュメント

- [認証・セキュリティ設計](security)
- [DWH 4層アーキテクチャ](dwh-layers)

---

*最終更新: 2025-12-02*
