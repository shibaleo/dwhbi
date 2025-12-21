# Obsidian Vault → VitePress + RAG 統合計画書

## 概要

Obsidianで編集するmarkdownノートを、認証付きWebサイトとして公開し、同時にDWH+BIのRAGナレッジベースとして活用するシステムを構築する。

### 目的
- 「第二の私」としてのパーソナルナレッジベース構築
- LLMによるセマンティック検索（RAG）対応
- 複数PCでのシームレスな編集環境

### 哲学
DWH+BIの「人生分化」の延長として、思考・メモ・知識を60年スケールで蓄積・検索可能にする。

---

## プロジェクト情報

| 項目 | 値 |
|------|------|
| GitHubリポジトリ | `shibaleo/vault` (Private) |
| Supabaseプロジェクト | `dwhbi` |
| ローカルパス | MEGA同期フォルダ内 `vault/` |
| プロジェクト名 | DWH+BI (Obsidian Integration) |

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        ローカル環境                              │
├─────────────────────────────────────────────────────────────────┤
│  MEGA Sync                                                      │
│  └── vault/                  ← Obsidian Vault = Git Repo        │
│      ├── .obsidian/          ← Obsidian設定                     │
│      ├── .git/               ← バージョン管理                    │
│      ├── .vitepress/         ← VitePress設定                    │
│      │   └── config.ts                                          │
│      ├── middleware.ts       ← Vercel Edge (Supabase Auth)      │
│      ├── package.json                                           │
│      ├── vercel.json                                            │
│      ├── login.md            ← ランディングページ               │
│      ├── assets/             ← 画像ファイル                     │
│      └── notes/              ← Obsidianで編集するmd             │
│          └── **/*.md                                            │
└─────────────────────────────────────────────────────────────────┘
                    │
                    │ git push
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                GitHub (Private Repo: shibaleo/vault)            │
└─────────────────────────────────────────────────────────────────┘
          │                                    │
          │ Vercel連携                          │ GitHub Contents API
          ▼                                    ▼
┌──────────────────────┐           ┌──────────────────────────────┐
│       Vercel         │           │  DWH+BI GitHub Actions       │
│  ┌────────────────┐  │           │  (日次バッチ)                 │
│  │ VitePress SSG  │  │           │                              │
│  └────────────────┘  │           │  1. mdファイル取得            │
│  ┌────────────────┐  │           │  2. frontmatter解析          │
│  │ Edge Middleware│  │           │  3. heading分割              │
│  │ (Supabase Auth)│  │           │  4. embedding生成            │
│  └────────────────┘  │           │  5. pgvector保存             │
└──────────────────────┘           └──────────────────────────────┘
          │                                    │
          │ 認証                                │
          ▼                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Supabase (dwhbi)                             │
│  ┌─────────────┐  ┌─────────────────────────────────────────┐   │
│  │    Auth     │  │              PostgreSQL                  │   │
│  │ (Magic Link)│  │  ┌─────────────────────────────────────┐ │   │
│  └─────────────┘  │  │ raw.obsidian_notes                  │ │   │
│                   │  │   - file_path, content, frontmatter │ │   │
│  ┌─────────────┐  │  ├─────────────────────────────────────┤ │   │
│  │   Vault     │  │  │ staging.document_chunks             │ │   │
│  │ (トークン)   │  │  │   - heading単位で分割               │ │   │
│  └─────────────┘  │  ├─────────────────────────────────────┤ │   │
│                   │  │ core.document_sections              │ │   │
│                   │  │   - embedding (pgvector)            │ │   │
│                   │  └─────────────────────────────────────┘ │   │
│                   └─────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## 役割分担

| ツール | 責任 | 特性 |
|--------|------|------|
| Obsidian | 編集 | 使いやすいUI、wikilink、ローカル動作 |
| MEGA | PC間同期 | リアルタイム同期、E2E暗号化、.megaignore対応 |
| Git/GitHub | バージョン管理 | 履歴、差分、rollback、Private Repo |
| VitePress | Web表示 | 静的サイト生成、検索機能、美しいUI |
| Vercel | ホスティング | Edge Middleware、自動デプロイ |
| Supabase Auth | 認証 | Magic Link、セッション管理 |
| DWH+BI | RAGパイプライン | embedding生成、既存インフラ統合 |

---

## 実装計画

### Phase 1: 基盤構築

#### 1.1 GitHubプライベートリポジトリ作成
- [x] リポジトリ名: `shibaleo/vault`
- [x] Private設定
- [x] README.md初期化

#### 1.2 MEGA内にローカル環境構築
- [x] MEGAフォルダ内にプロジェクトディレクトリ作成
- [x] git clone / git remote設定
- [x] .megaignore作成（MEGA/.megaignoreに追記）

```
# vault - VitePress build artifacts
-d:vault/node_modules
-d:vault/.vitepress/cache
-d:vault/.vitepress/dist
-f:vault/.DS_Store
-f:vault/Thumbs.db
-f:vault/*.log
```

#### 1.3 VitePressプロジェクト初期化
```bash
npm init -y
npm install vitepress --save-dev
mkdir notes
echo "# Welcome" > notes/index.md
```

#### 1.4 Obsidian Vault設定
- [ ] Obsidianで該当フォルダをVaultとして開く
- [ ] 設定調整（リンク形式など）

### Phase 2: 認証付きデプロイ

#### 2.1 Supabase Auth設定
- [ ] 既存Supabaseプロジェクト(dwhbi)にユーザー作成（自分用1人）
- [ ] Magic Link or Email+Password設定

#### 2.2 Vercel Middleware実装
```typescript
// middleware.ts
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const config = { matcher: ['/((?!login|_assets|api).*)'] }

export default async function middleware(req) {
  const token = req.cookies.get('sb-access-token')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}
```

#### 2.3 ログインページ作成
- [ ] login.md または カスタムVueコンポーネント
- [ ] Supabase Auth UIまたは自作フォーム

#### 2.4 Vercel連携
- [ ] GitHubリポジトリ(shibaleo/vault)とVercel接続
- [ ] 環境変数設定 (SUPABASE_URL, SUPABASE_ANON_KEY)
- [ ] 自動デプロイ確認

### Phase 3: RAGパイプライン（DWH+BI統合）

#### 3.1 DBスキーマ作成
```sql
-- raw.obsidian_notes
CREATE TABLE raw.obsidian_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  frontmatter JSONB,
  file_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- staging.document_chunks
CREATE TABLE staging.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID REFERENCES raw.obsidian_notes(id),
  heading_path TEXT[],
  chunk_content TEXT NOT NULL,
  chunk_order INT NOT NULL,
  token_count INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- core.document_sections (pgvector)
CREATE TABLE core.document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID REFERENCES staging.document_chunks(id),
  embedding vector(1536),  -- text-embedding-3-small
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3.2 DWH+BI src/obsidian/ 実装
```
packages/
└── obsidian/              ← 新規パッケージ
    ├── src/
    │   ├── types.ts
    │   ├── fetch_from_github.ts
    │   ├── parse_markdown.ts
    │   ├── generate_embeddings.ts
    │   ├── write_db.ts
    │   └── sync_daily.ts
    └── package.json
```

#### 3.3 GitHub Actions統合
- [ ] 既存の日次バッチにobsidian syncジョブ追加
- [ ] GitHub PAT（Private repo読み取り用）をSupabase Vaultに保存
- [ ] 対象リポジトリ: `shibaleo/vault`

### Phase 4: RAG検索機能

#### 4.1 検索エンドポイント
- [ ] Supabase Edge Function or API Route
- [ ] クエリをembedding化 → pgvector類似検索

#### 4.2 LLMへの統合
- [ ] 検索結果をコンテキストとしてLLMに渡す
- [ ] 「第二の私」としてのパーソナルアシスタント

---

## 技術的考慮事項

### 認証
- Supabase AuthのセッションをVercel Edge Middlewareで検証
- トークンはcookieベースで管理
- 自分専用なので初回ユーザー登録は手動（Supabase Dashboard）

### embedding生成
- OpenAI `text-embedding-3-small` (1536次元)
- チャンク単位: heading (`##`)で分割
- 差分更新: file_hashで変更検知

### 容量管理
- 画像含めても当面1GB未満の見込み
- 1GB超過時は画像をSupabase Storageに移行検討

### .megaignore
- MEGA/.megaignoreに vault/ プレフィックス付きで記述
- node_modules, .vitepress/cache, distを除外
- ローカルプレビュー時のみnpm install、終わったら削除も可

---

## ファイル構成（最終形）

```
MEGA/
├── .megaignore              ← vault用の除外設定を追記
└── vault/
    ├── .obsidian/
    │   ├── app.json
    │   └── ...
    ├── .git/
    ├── .gitignore
    ├── .vitepress/
    │   ├── config.ts
    │   └── theme/
    │       └── LoginPage.vue (optional)
    ├── middleware.ts
    ├── package.json
    ├── vercel.json
    ├── login.md
    ├── assets/
    │   └── *.png, *.jpg
    └── notes/
        ├── index.md
        ├── daily/
        │   └── 2025-01-15.md
        ├── projects/
        │   └── dwhbi.md
        └── ideas/
            └── *.md
```

---

## 次のステップ（優先順）

1. ~~GitHubプライベートリポジトリ作成~~ ✅ `shibaleo/vault`
2. ~~MEGA内にクローン、.megaignore設定~~ ✅
3. VitePress初期化、基本構成確認
4. Obsidian Vault設定
5. Vercel連携、認証なしでまずデプロイ確認
6. Supabase Auth + Middleware追加
7. DWH+BI側にobsidianパッケージ追加
8. RAGパイプライン実装・テスト

---

## 参考情報

- VitePress: https://vitepress.dev/
- Supabase Auth: https://supabase.com/docs/guides/auth
- Vercel Edge Middleware: https://vercel.com/docs/functions/edge-middleware
- pgvector: https://github.com/pgvector/pgvector
- MEGA .megaignore: https://help.mega.io/installs-apps/desktop/exclusion-rules

---

*作成日: 2025-12-20*
*プロジェクト: DWH+BI - Obsidian Integration*
