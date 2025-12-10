---
title: セットアップガイド
description: 開発環境のセットアップ手順
---

# セットアップガイド

## 前提条件

- Python 3.12+
- Node.js 20+
- Supabase アカウント
- 各サービスの API 認証情報

## 開発環境セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-repo/supabase-sync-jobs.git
cd supabase-sync-jobs
```

### 2. Python 環境

```bash
# 仮想環境作成
python -m venv .venv

# アクティベート (Windows)
.venv\Scripts\activate

# アクティベート (Mac/Linux)
source .venv/bin/activate

# 依存関係インストール
pip install -r requirements.txt
```

### 3. 環境変数

```bash
# .env ファイル作成
cp .env.example .env

# 必須の環境変数
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 4. Supabase セットアップ

```bash
# Supabase CLI インストール
npm install -g supabase

# ログイン
supabase login

# マイグレーション実行
supabase db push
```

## 管理コンソールセットアップ

```bash
cd console

# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev
```

### 環境変数（console/.env.local）

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 各サービスの認証設定

### Toggl Track

1. https://track.toggl.com/profile からAPI Tokenを取得
2. 管理ダッシュボードで設定

### Fitbit

1. https://dev.fitbit.com/ でアプリ登録
2. OAuth 2.0 認証フロー実行
3. 管理ダッシュボードで設定

### Zaim

1. https://dev.zaim.net/ でアプリ登録
2. OAuth 1.0a 認証フロー実行
3. 管理ダッシュボードで設定

### Google Calendar

1. Google Cloud Console でサービスアカウント作成
2. Calendar API 有効化
3. 認証情報 JSON を取得
4. 管理ダッシュボードで設定

### Tanita Health Planet

1. https://www.healthplanet.jp/ でアプリ登録
2. OAuth 2.0 認証フロー実行
3. 管理ダッシュボードで設定

### Trello

1. https://trello.com/app-key でAPI Key取得
2. Token生成
3. 管理ダッシュボードで設定

### TickTick

1. https://developer.ticktick.com/ でアプリ登録
2. OAuth 2.0 認証フロー実行
3. 管理ダッシュボードで設定

### Airtable

1. https://airtable.com/create/tokens でPAT作成
2. 必要なスコープを付与
3. 管理ダッシュボードで設定

## 動作確認

```bash
# 単一サービスの同期テスト
python -m pipelines.services.toggl

# テスト実行
pytest tests/pipelines/ -v
```
