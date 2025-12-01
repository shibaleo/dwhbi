# LIFETRACER 設計ドキュメント

このドキュメントは、未実装の機能や将来の設計方針をまとめたものです。

## 目次

- [DWH 4層アーキテクチャ](#dwh-4層アーキテクチャ)
- [refスキーマとAirtable](#refスキーマとairtable)
- [配布設計](#配布設計)
- [TODO（優先度順）](#todo優先度順)
- [ドキュメント作成予定](#ドキュメント作成予定)

---

## DWH 4層アーキテクチャ

### 目標構造

```
┌─────────────────────────────────────────────────────────────────────┐
│ marts.*                                                             │
│   分析・集計ビュー                                                  │
│   agg_daily_health, agg_weekly_productivity                         │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ core.*                                                              │
│   サービス統合済みビジネスエンティティ（サービス名が消える）        │
│   fct_time_entries, fct_transactions, dim_categories                │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ staging.*                                                           │
│   クリーニング・正規化済み（ビュー）                                │
│   stg_toggl__entries, stg_zaim__transactions                        │
└─────────────────────────────────────────────────────────────────────┘
                                    ▲
┌─────────────────────────────────────────────────────────────────────┐
│ raw.*                                                               │
│   外部APIからの生データ（テーブル）                                 │
│   toggl_entries, zaim_transactions, fitbit_sleep                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 設計思想

| 層 | 役割 | サービス名 | 形式 |
|----|------|-----------|------|
| raw | APIレスポンスをそのまま保存 | あり | テーブル |
| staging | 型変換、列名正規化、タイムゾーン変換 | あり | ビュー |
| core | 複数サービスの統合、ビジネスエンティティ化 | **なし** | ビュー |
| marts | 分析・集計、ドメイン別ビュー | なし | ビュー |

### サービス非依存の設計

core層以降ではサービス名が消える。これにより：
- 将来Togglから別サービスに移行しても、core/marts層は変更不要
- 分析クエリは `fct_time_entries` を参照し、データソースを意識しない
- staging層で新旧サービスを統合するロジックを吸収

### 命名規則

| 層 | プレフィックス | 例 |
|----|---------------|----|
| staging | `stg_{service}__{entity}` | stg_toggl__entries |
| core | `fct_` / `dim_` | fct_time_entries, dim_projects |
| marts | `agg_` / ドメイン名 | agg_daily_health |

---

## refスキーマとAirtable

### 役割分担

| スキーマ/サービス | 役割 | 同期方向 |
|------------------|------|----------|
| Airtable | マスタデータの編集UI | - |
| ref.* | マスタデータの永続化（テーブル） | Airtable → ref |
| core.dim_* | マスタの統合ビュー | ref → core（ビュー参照） |

### データフロー

```
Airtable（編集UI、無料枠1,000件/base）
    ↓ sync（Airtable API）
ref.expense_categories（Supabase、永続化）
    ↓ view
core.dim_expense_categories
```

### 設計意図

- **Airtable**: モバイル対応、型強制、バリデーション機能を持つ編集UI
- **ref**: Supabase内でのマスタデータ永続化層
- **無料枠1,000件の制約**: マスタ専用という役割を物理的に強制（分析対象にはならない）

### Notionとの使い分け

| サービス | 用途 | スキーマ |
|---------|------|----------|
| Airtable | マスタ編集UI（静的、増えない） | ref.* |
| Notion | 分析対象データソース（時系列で増える） | raw.* |

### ⚠️ 双方向同期の注意点

マッピングテーブル（例: Togglプロジェクト → カテゴリ）を作成する場合、IDの管理が必要：

```
1. Supabaseでレコード作成時にIDが生成される
2. そのIDをAirtableに同期する必要がある（Supabase → Airtable）
3. Airtable側での編集はAirtable → Supabaseで同期
```

同期パターン：
- **通常のマスタ**: Airtable → ref（一方向）
- **IDを含むマッピング**: 初回はref → Airtable、以降はAirtable → ref

ID競合を避けるため、Airtable側ではSupabaseのIDを編集不可フィールドとして表示する設計を推奨。

---

## 配布設計

### 設計哲学

**テンプレート提供に徹する**

- 他人のアプリを管理しない
- リポジトリは突然消える可能性がある
- 各ユーザーが真の意味で主導権を持つ

**60年運用の思想と一貫**

各ユーザーが全リソースを所有し、テンプレート提供者（私）への依存なく運用できること。

```
私 ────提供────→ テンプレート
                    ↓ fork
ユーザー ─所有─→ 全リソース

私のリポジトリが消えても、ユーザーのシステムは動き続ける
```

### 最小構成（2サービス）

| サービス | 役割 | 無料枠 |
|---------|------|--------|
| **GitHub** | コード、Actions（同期ジョブ）、Pages（管理UI） | Actions 2000分/月 |
| **Supabase** | PostgreSQL、認証情報保存 | DB 500MB |

```
GitHub
├── Private Repository
├── Secrets（client_secret、ENCRYPTION_KEY保存）
├── Actions（ビルド + 同期ジョブ）
└── Pages（管理UI、secret注入済み）

Supabase
└── PostgreSQL（データ + 暗号化token）
```

### 管理UI設計

**GitHub Pages + ビルド時secret注入**

```
1. client_secretはGitHub Secretsに保存
2. GitHub ActionsでPages用JSをビルド
3. ビルド時に環境変数を注入
4. 生成されたJSにclient_secretが含まれる
5. GitHub Pagesで配信
```

**セキュリティのトレードオフ**

| 観点 | 評価 |
|------|------|
| 正統なセキュリティ | ✗ client_secretがクライアントに露出 |
| 実質的なリスク | △ URLを知らなければアクセスされない |
| 被害の深刻度 | 低（金銭被害なし、データ閲覧のみ） |
| シンプルさ | ◎ Edge Functions不要 |

→ 親しい人向け・自己責任で使うなら許容範囲

### ツールの役割分担

| ツール | 役割 | 頻度 |
|--------|------|------|
| 管理UI（GitHub Pages） | 認証管理、OAuth再認証、復旧作業 | 月数回 |
| Airtable | マスタデータ編集 | 順時 |
| Grafana Cloud | 分析ダッシュボード、可視化 | 日常的 |

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  管理UI          │     │  Airtable        │     │  Grafana Cloud   │
│  - OAuth再認証   │     │  - マスタ編集    │     │  - 時間分析      │
│  - トークン復旧  │     │  - カテゴリ管理  │     │  - 支出推移      │
│  （低頻度）      │     │  （順時）        │     │  - 健康指標      │
└─────────┬────────┘     └─────────┬────────┘     └─────────┬────────┘
          │                        │                        │
          └────────────┬───────────┴────────────┘
                       │
                       ▼
               ┌───────────────┐
               │   Supabase    │
               │   PostgreSQL  │
               └───────────────┘
```

### ユーザーセットアップフロー

**初期設定（1回、手動）**

```
1. GitHub「Use this template」でリポジトリ作成（Private）
2. Supabaseプロジェクト作成
3. 各サービスでOAuthアプリ登録
   - callback URI: https://{username}.github.io/{repo}/callback/{service}
4. GitHub Secretsに設定
   - client_id / client_secret（各サービス）
   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
   - TOKEN_ENCRYPTION_KEY
5. GitHub Pages有効化（Settings → Pages）
6. supabase db push でマイグレーション適用
```

**日常運用（ボタン1つ）**

```
┌─────────────────────────────────────────┐
│  管理UI                                 │
│                                         │
│  [Fitbitを連携]  [Tanitaを連携]  ...    │
│       ↓                                 │
│  OAuth画面 → 許可 → 自動保存 → 完了     │
└─────────────────────────────────────────┘
```

**障害時**

- トークン期限切れ → 「再連携」ボタン押すだけ
- よくわからないエラー → 最初からやり直し

「直す」より「作り直す」のほうが非エンジニアには分かりやすい。

### ドキュメント責任の分離

| 項目 | ドキュメント |
|------|-------------|
| GitHub PAT | GitHub公式（膨大、多言語対応） |
| Supabaseプロジェクト作成 | Supabase公式 |
| 各サービスOAuth登録 | 各サービス公式 + 自前で最低限（callback URI、スコープ一覧） |
| 管理UIの使い方 | 自前（直感的なUIを目指す） |

### 認証情報の階層構造

```
GitHub PAT（手動、公式ドキュメント参照）
    │
    ├─→ GitHub Secrets 設定
    │       ├── SUPABASE_URL
    │       ├── SUPABASE_SERVICE_ROLE_KEY
    │       ├── TOKEN_ENCRYPTION_KEY
    │       └── 各サービスのclient_id / client_secret
    │
    └─→ GitHub Actions 実行
            │
            ▼
        Supabase credentials.services
            ├── Fitbit tokens
            ├── Tanita tokens
            ├── Toggl credentials
            ├── Zaim credentials
            └── etc.
```

---

## TODO（優先度順）

### 🔴 緊急度：高（運用停止リスク）

| タスク | 内容 | ステータス |
|--------|------|------------|
| ENCRYPTION KEY復旧手順 | 紛失時の認証情報再設定フロー、全サービスの再認証手順 | 未着手 |
| OAuth再認証手順 | リフレッシュトークン失効時の手動再認証フロー（Fitbit, Tanita, Zaim） | 未着手 |
| Phase 6: 同期テスト | sync_daily.ts の動作確認 | 未着手 |
| Phase 7: .env整理 | SUPABASE_* と TOKEN_ENCRYPTION_KEY 以外を削除 | 未着手 |

### 🟠 優先度：高（ドキュメント・運用基盤）

| タスク | 内容 | ステータス |
|--------|------|------------|
| 各サービス接続ドキュメント | API登録、OAuth設定、credentials.services への初期データ投入手順 | 未着手 |
| バックアップ・リストア手順 | Supabaseデータの定期エクスポート、pg_dump/restore手順 | 未着手 |
| ローカル開発環境セットアップ | 新PC/新環境での構築手順、必要なツール一覧 | 未着手 |
| Phase 8: 旧tokens削除 | fitbit.tokens, tanita.tokens テーブル削除 | 未着手 |

### 🟡 優先度：中（アーキテクチャ・品質）

| タスク | 内容 | ステータス |
|--------|------|------------|
| Phase 9: DWH 4層構築 | staging/core/marts層のビュー作成 | 未着手 |
| 管理UI構築 | GitHub Pages + ビルド時secret注入、OAuthフロー実装 | 未着手 |
| Airtable連携 | refスキーマとの同期、マスタ編集UI | 未着手 |
| Grafana Cloud連携 | PostgreSQLデータソース設定、ダッシュボード作成 | 未着手 |
| マイグレーション管理方針 | 保管場所、命名規則、ロールバック手順 | 未着手 |
| 同期失敗アラート | GitHub Actions失敗時のSlack/メール通知 | 未着手 |
| 新サービス追加テンプレート | ボイラープレートコード、チェックリスト | 未着手 |
| スキーマ変更手順 | 新フィールド追加時のマイグレーションフロー | 未着手 |
| 整合性チェッククエリ | raw↔staging↔coreの件数・欠損確認SQL | 未着手 |

### 🟢 優先度：低（耐障害性・将来対応）

| タスク | 内容 | ステータス |
|--------|------|------------|
| Supabase終了時の移行計画 | PostgreSQLエクスポート、別ホストへの移行手順 | 未着手 |
| 各サービスAPI廃止時の対応 | データ保全方針、代替サービス選定基準 | 未着手 |
| Airtable終了時の代替 | ref層UIの移行先候補（NocoDB等） | 未着手 |
| 重複検知クエリ | 同期ミスによる重複レコードの検出・修正SQL | 未着手 |

---

## ドキュメント作成予定

```
docs/
├── SETUP.md                    # ローカル開発環境セットアップ
├── USER_SETUP.md               # ユーザー向けセットアップガイド（テンプレート利用者用）
├── SERVICE_CONNECTION.md       # 各サービスへの接続方法（OAuthアプリ登録、callback URI設定）
├── ENCRYPTION_KEY_RECOVERY.md  # ENCRYPTION KEY復旧手順
├── OAUTH_REAUTH.md             # OAuth再認証手順
├── BACKUP_RESTORE.md           # バックアップ・リストア手順
├── MIGRATION_POLICY.md         # マイグレーション管理方針
├── NEW_SERVICE_GUIDE.md        # 新サービス追加ガイド
└── DISASTER_RECOVERY.md        # 障害復旧計画
```

## 配布設計 (Revised: Security-First Approach)

### 1. 設計哲学（テンプレート提供に徹する）

* **基本方針:** LIFETRACERは、**60年運用の思想**に基づき、ユーザーが全ての権限とリソースを所有する**テンプレート（配布物）**として提供される。
* **最小構成:** **GitHub (リポジトリ/Pages/Actions)** と **Supabase (DB/Auth/Edge Functions)** の2サービス構成を維持する。

### 2. セキュリティ課題の解決（Client Secretの隔離）

元の設計における最大の課題は、OAuth連携に必要な **Client Secret** がクライアント側（GitHub Pagesで配信されるJavaScript）に露出する点であった。これを解決するため、以下の構成を採用する。

* **機密情報の隔離:**
    * **Client Secret** は、Supabase DB内の専用テーブル（`ref.secrets`）にのみ保存し、クライアントサイドには一切露出させない。
    * このテーブルへのアクセスは、Supabaseの**サービスロールキー**を持つ**サーバーサイドコンポーネント**（Edge Functions および GitHub Actions）に限定する。
* **認証・同期処理の分担:**
    * **初回トークン交換（認証時）:** **Supabase Edge Functions**が実行する。FunctionsがDBから Secret を安全に読み出し、トークン交換処理を行い、取得したトークン（暗号化済み）をDBに保存する。
    * **継続的データ同期（運用時）:** **GitHub Actions**が実行する。ActionsがDBから Secret および Refresh Token を安全に読み出し、トークンリフレッシュとデータ取得を行う。

### 3. 管理UIのアクセス制御と初回設定の簡略化

利用者＝管理者であるユーザーの利便性とセキュリティを両立させるため、管理UI（GitHub Pages）に**Supabase Auth**による認証機能を追加する。

| 機能 | コンポーネント | 実現内容 |
| :--- | :--- | :--- |
| **アクセス制限** | **Supabase Auth / GitHub Pages** | 管理UIへのアクセスを、Supabaseに登録されたユーザー（テンプレート所有者）のみに限定する。URL直打ちによる第三者のアクセスを防ぐ。 |
| **安全なSecret入力** | **Edge Functions / Supabase DB** | ユーザーはログイン後、ブラウザ上の管理UIでClient Secretを一度だけ入力できる。この情報は、**認証済みユーザーのJWT**と共に **HTTPS通信** で **Edge Function** に送信され、**DB**に安全に保存される。 |

### 4. ユーザーセットアップフロー（Client Secret入力含む）

1.  GitHubでリポジトリ作成、Pages有効化。
2.  Supabaseプロジェクト作成、スキーマ（`ref.secrets`含む）と**Edge Functions**をデプロイ。
3.  Supabase Authで管理者アカウントを登録。
4.  FitbitなどのOAuthアプリを作成し、**Callback URI**を**デプロイしたEdge Functionのエンドポイント**に設定。
5.  GitHub Pagesの管理UIへ**ログイン**（Supabase Auth利用）。
6.  ログイン後、管理UIのフォームに**Client IDとClient Secret**を入力・送信。
7.  Edge Functionが**認証済みリクエスト**を確認後、DBの `ref.secrets` にClient Secretを安全に保存する。

### 5. 将来的なデータ公開への対応

Supabase AuthとRLS（Row Level Security）を最大限活用することで、将来的なデータ公開にも対応できる。

* **管理者認証:** 現在の設計通り、システム管理者としての管理UIへのアクセスを制御。
* **ビューア認証:** データ公開用の**別ユーザーアカウント**をSupabase Authで管理し、**`marts` スキーマ**のビューに対して「認証済みビューアは閲覧のみ可能」といった**きめ細やかなアクセス制御**をRLSで適用する。

---

## TODO（優先度順）

### 🔴 優先度：高（リリース必須）

| タスク | 内容 | ステータス |
|--------|------|------------|
| OAuth再認証手順 | トークン期限切れ・失効時のリカバリ手順 | **見直し中** (Edge Functions利用前提で再設計) |
| ENCRYPTION KEY復旧手順 | トークン暗号化キー紛失時のリカバリ手順 | 未着手 |
| **セキュリティ強化版管理UI** | **GitHub PagesへのSupabase Authログイン機能と、認証済みEdge Function経由でのClient Secret登録フォームの実装** | **設計完了** (実装前) |
| **Edge Functionの実装** | **初回OAuthトークン交換、認証済みClient Secret登録APIの実装** | **設計完了** (実装前) |
| 初期データ投入手順 | 未着手 |
| バックアップ・リストア手順 | Supabaseデータの定期エクスポート、pg_dump/restore手順 | 未着手 |
| ローカル開発環境セットアップ | 新PC/新環境での構築手順、必要なツール一覧 | 未着手 |
| Phase 8: 旧tokens削除 | fitbit.tokens, tanita.tokens テーブル削除 | 未着手 |

### 🟡 優先度：中（アーキテクチャ・品質）

| タスク | 内容 | ステータス |
|--------|------|------------|
| Phase 9: DWH 4層構築 | staging/core/marts層のビュー作成 | 未着手 |
| 管理UI構築 | GitHub Pages + ビルド時secret注入、OAuthフロー実装 | **置き換え** (セキュリティ強化版管理UIタスクへ) |
| Airtable連携 | refスキーマとの同期、マスタ編集UI | 未着手 |
| Grafana Cloud連携 | PostgreSQLデータソース設定、ダッシュボード作成 | 未着手 |
| マイグレーション管理方針 | 保管場所、命名規則、ロールバック手順 | 未着手 |
| 同期失敗アラート | GitHub Actions失敗時のSlack/メール通知 | 未着手 |
| 新サービス追加テンプレート | ボイラープレートコード、チェックリスト | 未着手 |
| スキーマ変更手順 | 新フィールド追加時のマイグレーションフロー | 未着手 |
| 整合性チェッククエリ | raw↔staging↔coreの件数・欠損確認SQL | 未着手 |

### 🟢 優先度：低（耐障害性・将来対応）

| タスク | 内容 | ステータス |
|--------|------|------------|
| Supabase終了時の移行計画 | PostgreSQLエクスポート... | 未着手 |

### デプロイ設計

管理画面はgithub pagesではなく、vercelを利用。
管理画面初回ログイン時にはsupabase authを利用して認証を行う。
個人データ配信のためにauth 不要なlanding pageを作成するか否かのトグルボタンを実装する。
一般ユーザ向けのログインもsupabase authを利用する。
トークンの入力は管理画面で行い、vercel functions経由でsupabaseに保存する。
ただし、使い捨ての暗号化キーをその場で作成し、vercelの環境変数へ設定させる。
supabaseへは暗号化して保存。
暗号化キーを紛失した場合は、再登録が必要。
supabase functionsでoauthのcallbackを受け取り、トークン交換とsupabaseへの保存を行う。
データの可視化はgrafana cloudを利用する。これにより、可視化基盤のクラウド化とデータの公開範囲の設定を実現できる。
そうなると管理画面はいらないかも。

---

## 技術スタック刷新（Deno → Python + dbt）

### 移行の背景

現在Denoで実装されているデータ同期スクリプトを、Python + dbt に移行する。

**移行理由:**
1. **データ変換の標準化**: DWH 4層（raw → staging → core → marts）をdbtで実装
2. **エコシステムの充実**: データエンジニアリング領域ではPythonが標準
3. **Edge Functions の実用途**: OAuth callbackのみ（Supabase標準のDeno利用）
4. **管理UIの技術選定**: Vercel + Next.js（Node.js環境）
5. **60年運用思想**: PostgreSQL + Python + dbt は枯れた技術スタック

**Denoの残存箇所**: Supabase Edge Functions **のみ**（OAuthトークン交換処理）

### 技術スタック

| レイヤー | 技術 | 実行環境 | 用途 |
|---------|------|---------|------|
| **API同期 → raw** | Python 3.12+ | GitHub Actions | 外部API呼び出し、raw層への書き込み |
| **raw → staging** | dbt (SQL) | GitHub Actions | 型変換、カラム正規化、タイムゾーン変換 |
| **staging → core** | dbt (SQL) | GitHub Actions | サービス統合、ビジネスエンティティ化 |
| **core → marts** | dbt (SQL) | GitHub Actions | 分析集計、ドメイン別ビュー |
| **管理UI** | Next.js + Vercel | Vercel Edge | OAuth再認証、Client Secret登録 |
| **OAuth Callback** | Deno (Edge Functions) | Supabase | トークン交換、DB保存 |
| **可視化** | Grafana Cloud | - | PostgreSQL接続、ダッシュボード |

### データフロー

```
External APIs
    ↓ Python (pipelines/)
Supabase raw.*
    ↓ dbt models (transform/models/staging/)
Supabase staging.*
    ↓ dbt models (transform/models/core/)
Supabase core.*
    ↓ dbt models (transform/models/marts/)
Supabase marts.*
    ↓ PostgreSQL datasource
Grafana Cloud
```

---

## モノレポ構成

### リポジトリ全体の目的

**LIFETRACER = Personal Data Warehouse Platform**

個人の生活データ（健康・時間・支出）を統合し、60年間の長期運用に耐える分析基盤を提供する。

### フォルダ構成

```
lifetracer/                           # モノレポルート
│
├── pipelines/                        # データ収集（Python）
│   ├── __init__.py
│   ├── main.py                       # オーケストレーター
│   ├── services/                     # API同期スクリプト
│   │   ├── __init__.py
│   │   ├── fitbit.py
│   │   ├── tanita.py
│   │   ├── toggl.py
│   │   ├── zaim.py
│   │   ├── gcalendar.py
│   │   └── notion.py
│   ├── lib/                          # 共通ライブラリ（基盤機能）
│   │   ├── __init__.py
│   │   ├── credentials.py            # 認証情報取得・復号
│   │   ├── db.py                     # Supabase client
│   │   ├── encryption.py             # AES-GCM暗号化
│   │   ├── logger.py                 # ロギング
│   │   └── sync_state.py             # 同期状態管理
│   └── utils/                        # 汎用ユーティリティ
│       ├── __init__.py
│       ├── dates.py                  # 日付操作
│       └── retry.py                  # リトライロジック
│
├── transform/                        # dbt project（データ変換）
│   ├── dbt_project.yml
│   ├── profiles.yml
│   ├── models/
│   │   ├── staging/                  # raw → staging
│   │   │   ├── _sources.yml
│   │   │   ├── stg_fitbit__sleep.sql
│   │   │   ├── stg_toggl__entries.sql
│   │   │   └── ...
│   │   ├── core/                     # staging → core（サービス非依存化）
│   │   │   ├── fct_time_entries.sql
│   │   │   ├── fct_transactions.sql
│   │   │   ├── fct_health_metrics.sql
│   │   │   └── dim_categories.sql
│   │   └── marts/                    # core → marts（分析用集計）
│   │       ├── health/
│   │       │   └── agg_daily_health.sql
│   │       ├── productivity/
│   │       │   └── agg_weekly_time.sql
│   │       └── finance/
│   │           └── agg_monthly_expense.sql
│   ├── macros/
│   ├── tests/
│   └── seeds/
│
├── app/                              # 管理UI（Next.js App Router）
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── services/                 # サービス接続管理
│   │   │   └── page.tsx
│   │   ├── secrets/                  # Client Secret登録
│   │   │   └── page.tsx
│   │   └── sync-status/              # 同期状態確認
│   │       └── page.tsx
│   ├── api/                          # Vercel Functions
│   │   ├── register-secret/
│   │   │   └── route.ts
│   │   └── auth/
│   │       └── [...nextauth]/
│   │           └── route.ts
│   ├── components/
│   │   ├── ServiceCard.tsx
│   │   ├── SecretForm.tsx
│   │   └── SyncStatusTable.tsx
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── api-client.ts
│   ├── types/
│   │   └── index.ts
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   └── package.json                  # app専用のpackage.json
│
├── shared/                           # 共有型定義・定数
│   ├── types/
│   │   ├── services.ts               # ServiceName型、ServiceConfig型
│   │   ├── credentials.ts            # 認証情報型
│   │   ├── sync.ts                   # 同期結果型
│   │   └── index.ts
│   └── constants/
│       ├── services.ts               # サービス一覧定数（SERVICES）
│       └── schemas.ts                # DBスキーマ名定数
│
├── supabase/
│   ├── config.toml
│   ├── functions/                    # Edge Functions（Deno）
│   │   ├── oauth-callback-fitbit/
│   │   │   ├── index.ts
│   │   │   └── deno.json
│   │   ├── oauth-callback-tanita/
│   │   ├── oauth-callback-zaim/
│   │   └── admin-secret-register/
│   └── migrations/
│       ├── 00001_create_raw_schema.sql
│       ├── 00002_create_credentials.sql
│       └── 00003_create_ref_schema.sql
│
├── tests/
│   ├── pipelines/                    # pytest（Python同期スクリプト）
│   │   ├── test_fitbit.py
│   │   └── ...
│   ├── transform/                    # dbt test結果格納
│   ├── app/                          # Vitest/Playwright（管理UI）
│   │   ├── unit/
│   │   └── e2e/
│   └── integration/
│       └── test_e2e_sync.py
│
├── .github/
│   └── workflows/
│       ├── sync-daily.yml            # pipelines/ 実行
│       ├── transform-daily.yml       # dbt run/test
│       ├── deploy-app.yml            # Vercelデプロイ
│       └── test.yml                  # pytest + dbt test
│
├── docs/
│   ├── DESIGN.md
│   ├── ARCHITECTURE.md               # システム全体アーキテクチャ
│   ├── SETUP.md                      # ローカル開発環境
│   └── USER_SETUP.md                 # テンプレート利用者向け
│
├── scripts/
│   ├── setup_local.sh
│   └── check_dependencies.py
│
├── pyproject.toml                    # Python依存管理（pipelines用）
├── requirements.txt
├── package.json                      # ルートpackage.json（workspaces管理）
├── .python-version
├── .gitignore
├── .env.example
├── next.config.js
├── tsconfig.json                     # TypeScript設定（shared + app）
├── vercel.json
└── README.md
```

### フォルダの責務

| フォルダ | 責務 | 言語/技術 | 実行環境 |
|---------|------|----------|---------|
| **pipelines/** | 外部API → raw層への同期 | Python 3.12+ | GitHub Actions |
| **transform/** | raw → staging → core → marts | dbt (SQL) | GitHub Actions |
| **app/** | 管理UI（OAuth再認証、設定） | Next.js | Vercel |
| **shared/** | 型定義・定数の共有 | TypeScript | app/, supabase/functions/ から参照 |
| **supabase/** | インフラ定義、Edge Functions | SQL, Deno | Supabase |
| **tests/** | 各レイヤーのテスト | pytest, dbt test, Vitest | ローカル/CI |
| **docs/** | ドキュメント | Markdown | - |

### 依存関係の境界

```
app/ ──→ shared/  ✅ OK（型定義を参照）
app/ ──→ pipelines/ ❌ NG
app/ ──→ transform/ ❌ NG

supabase/functions/ ──→ shared/ ✅ OK

pipelines/ ──→ shared/ ⚠️ 可能だが推奨しない
```

### package.json の分離

**ルート `package.json`** (workspaces管理)

```json
{
  "name": "lifetracer",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["app"],
  "scripts": {
    "dev": "npm run dev --workspace=app",
    "build": "npm run build --workspace=app"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

**app/package.json** (Next.js依存を閉じ込める)

```json
{
  "name": "@lifetracer/app",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "@supabase/supabase-js": "^2.38.0"
  }
}
```

### デプロイターゲット

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions (CI/CD)                                      │
│                                                             │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│ │ sync-daily   │  │ transform    │  │ deploy-app   │      │
│ │ pipelines/   │  │ transform/   │  │ app/         │      │
│ └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└────────┼──────────────────┼──────────────────┼─────────────┘
         ↓                  ↓                  ↓
    ┌─────────┐        ┌─────────┐       ┌─────────┐
    │ Python  │        │   dbt   │       │ Vercel  │
    │ 3.12+   │        │ (SQL)   │       │ (Edge)  │
    └────┬────┘        └────┬────┘       └────┬────┘
         │                  │                  │
         └──────────┬───────┴──────────────────┘
                    ↓
         ┌─────────────────────┐
         │  Supabase           │
         │  - PostgreSQL (DWH) │
         │  - Edge Functions   │
         │  - Auth             │
         └─────────────────────┘
```

### TypeScript設定の分離

**ルート `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "@shared/*": ["./shared/*"]
    }
  },
  "include": ["shared/**/*"],
  "exclude": ["node_modules", "app"]
}
```

**app/tsconfig.json**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "paths": {
      "@/*": ["./*"],
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

### 移行戦略

**Phase 1: Python同期スクリプト構築**

1. `pipelines/` フォルダ作成
2. Toggl の Python実装（最もシンプル）
3. GitHub Actions で動作確認
4. Deno版との並行運用（データ整合性検証）
5. 全サービス移行後、`src/` 削除

**Phase 2: dbt導入**

1. `transform/` フォルダ作成、dbt初期化
2. staging層モデル作成（`stg_toggl__entries.sql`）
3. core層モデル作成（`fct_time_entries.sql`）
4. marts層モデル作成（`agg_daily_productivity.sql`）
5. GitHub Actions統合（`dbt run && dbt test`）

**Phase 3: 管理UI（オプショナル）**

- Grafana Cloudで十分なら `app/` は作らない
- 必要と判明した場合のみ実装開始

### この構成のメリット

1. **型安全性**: `shared/types/` で型を一元管理
2. **依存の隔離**: Next.js依存は `app/package.json` に閉じる
3. **デプロイの独立性**: 各レイヤーが独立してデプロイ可能
4. **管理の一元化**: 1つのリポジトリで全体を把握
5. **60年運用思想**: `app/` を削除しても `pipelines/` + `transform/` は動作継続