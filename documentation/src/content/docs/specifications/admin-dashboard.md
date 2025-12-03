---
title: 管理ダッシュボード仕様
description: 認証情報登録と同期管理のためのWeb UI仕様
---

# 管理ダッシュボード仕様

## 概要

LIFETRACERの管理ダッシュボードは、各サービスの認証情報登録と同期状況の監視を行うWeb UIです。

## 設計方針

### 1ユーザー・1設定の原則

LIFETRACERは「個人の生活データを統合」が目的のため、各サービスにつき1ユーザに関するデータ収集のみをサポートします。

| 項目 | 方針 |
|------|------|
| ユーザーアカウント | 1つのみ |
| カレンダー | 1つのみ |

**理由**:
- スキーマのシンプルさを維持
- テンプレートとしての汎用性
- 複数アカウント統合が必要な場合はサービス側で対応

### セットアップの簡略化

GitHub OAuth Appの作成を不要にし、最小限の手順でデプロイできるようにします。

## 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| フレームワーク | Next.js (App Router) | Vercel親和性、API Routes |
| ホスティング | Vercel | サーバーレス関数が標準装備 |
| 認証 | Supabase Auth（メール + パスワード） | シンプル、追加設定不要 |
| UI | shadcn/ui + Tailwind CSS | テンプレートとの親和性 |
| シークレット保存 | Supabase Vault | 暗号化キー管理不要 |

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
│  │ Toggl   │ Fitbit  │ Zaim    │ Google  │                 │
│  │ Track   │         │         │ Cal.    │                 │
│  │ ✅ 連携中│ ✅ 連携中│ ⚠️ 要更新│ ❌ 未設定│                 │
│  │ [設定]  │ [設定]  │ [設定]  │ [設定]  │                 │
│  └─────────┴─────────┴─────────┴─────────┘                 │
│  ┌─────────┬─────────┬─────────┬─────────┐                 │
│  │ Tanita  │ Trello  │ TickTick│ Airtable│                 │
│  │ Health  │         │         │         │                 │
│  │ ✅ 連携中│ ✅ 連携中│ ✅ 連携中│ ✅ 連携中│                 │
│  │ [設定]  │ [設定]  │ [設定]  │ [設定]  │                 │
│  └─────────┴─────────┴─────────┴─────────┘                 │
│                                                             │
│  最終同期結果                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ サービス       最終同期            ステータス   件数   │   │
│  │ Toggl Track   2025-12-02 00:00    ✅ 成功     152件  │   │
│  │ Fitbit        2025-12-02 00:00    ✅ 成功     8件    │   │
│  │ Zaim          2025-12-01 00:00    ❌ 失敗     -      │   │
│  │               └─ エラー: トークン期限切れ              │   │
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

## 機能一覧

### サービス連携管理

| 機能 | 説明 | 実装方法 |
|------|------|---------|
| 連携状況表示 | 各サービスの連携状態を表示 | Vault読み取り |
| OAuth連携 | Fitbit, Tanita Health Planet, TickTick, Google Calendar, Zaim | API Routes でコールバック処理 |
| API Key登録 | Toggl Track, Trello, Airtable | フォーム入力 → Vault保存 |
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

## サービス設定項目

| サービス | 認証情報 | 固有設定 | 注記 |
|---------|---------|---------|------|
| Toggl Track | API Token |  |  |
| Google Calendar | Client ID/Secret |  |  |
| Zaim | Consumer Key/Secret | - | 1アカウントのみ |
| Fitbit | Client ID/Secret | - | 1アカウントのみ |
| Tanita Health Planet | Client ID/Secret | - | 1アカウントのみ |
| Trello | API Key, Token | - | 全ボード取得 |
| TickTick | Client ID/Secret | - | 1アカウントのみ |
| Airtable | PAT |  | 1アカウントのみ |

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

### API Key / PAT（Toggl Track, Trello, Airtable）

```
1. ダッシュボード → サービスの[設定]をクリック
2. API Key / Token + 固有設定の入力フォーム表示
3. 「保存」ボタン
4. API Route で全設定を Vault に保存
5. ダッシュボードに戻る（連携完了表示）
```

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
```

### profiles

ユーザー情報

```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  is_owner BOOLEAN DEFAULT FALSE,
  setup_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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

## 環境変数

### Vercel（必須）

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DIRECT_DATABASE_URL=postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
```

## GitHub連携（オプション）

### 機能比較

| 機能 | GitHub連携なし | GitHub連携あり |
|------|:-------------:|:-------------:|
| サービス連携管理 | ✅ | ✅ |
| 同期ログ確認 | ✅ | ✅ |
| 手動同期実行 | ❌ | ✅ Actions dispatch |
| Actions使用量表示 | ❌ | ✅ |
| 自動実行トグル | ❌ | ✅ |

### GitHub PAT設定

オーナー認証後、ダッシュボードの設定画面でPATを入力：

**Fine-grained PAT（推奨）**:
- `Actions`: Read and write（dispatch用）
- `Metadata`: Read-only（リポジトリ情報取得用）

**Classic PAT**:
- `repo`（プライベートリポジトリの場合）
- `workflow`
