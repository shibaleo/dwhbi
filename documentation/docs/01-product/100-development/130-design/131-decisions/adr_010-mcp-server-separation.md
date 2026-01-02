---
title: ADR-010 MCPサーバーのSupabase Edge Functions移行
description: MCPをconsoleからSupabase Edge Functionsに移行し、RAG・KG・Activityを統合したPersonal Contextサービスとして構築
status: 提案中
date: 2026-01-01
---

# ADR-010: MCPサーバーのSupabase Edge Functions移行

## ステータス

承認済み（Phase 1, 3, 4 完了）

## コンテキスト

現在、personal-knowledge MCP サーバーは `packages/console` 内の `/api/mcp` エンドポイントとして実装されている。

### Personal Context の概念

Personal Context は、LLMに「自分の文脈」を提供するための統合システムである。
**RAG**、**KG**、**Activity** の3つのデータソースを統合し、区別なく利用できる。

```
┌─────────────────────────────────────────────────────────────────┐
│                       Personal Context                           │
│         「LLMに自分の文脈を提供する統合システム」                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │      RAG      │  │      KG       │  │      Activity       │  │
│  │  (Vector DB)  │  │  (Graph DB)   │  │   (Time Series)     │  │
│  │               │  │               │  │                     │  │
│  │ ・ドキュメント │  │ ・エンティティ │  │ ・Toggl (作業記録)  │  │
│  │   チャンク検索 │  │   と関係      │  │ ・Calendar (予定)   │  │
│  │               │  │               │  │ ・Fitbit (健康)     │  │
│  │ ・セマンティック│  │ ・LLM対話から │  │ ・その他の行動データ │  │
│  │   類似度検索   │  │   生まれた記憶 │  │                     │  │
│  └───────────────┘  └───────────────┘  └─────────────────────┘  │
│                                                                  │
│  すべてのデータソースを統合的に検索・利用可能                      │
└─────────────────────────────────────────────────────────────────┘
```

**データソース:**
1. **RAG**: ドキュメント（Markdown）のセマンティック検索
2. **KG**: エンティティ・関係（ドキュメント抽出 + LLM対話から生成）
3. **Activity**: 行動データ（Toggl, Google Calendar, Fitbit等）

### 現状の構成

```
packages/console/
├── src/
│   ├── app/
│   │   └── api/mcp/route.ts      # MCPエンドポイント
│   └── lib/mcp/
│       ├── server.ts             # MCPサーバー定義
│       ├── repository.ts         # Supabase操作
│       ├── embedder.ts           # Voyage AI embedding
│       └── supabase.ts           # Supabase client
└── ...（Next.jsアプリケーション全体）
```

### 問題点

1. **デプロイの非効率性**
   - MCPツールを追加・修正するたびにconsole全体を再デプロイする必要がある
   - consoleのビルド時間が長い（Next.js + 多数の依存関係）
   - 不要なコード変更リスクが発生

2. **関心の分離**
   - MCPサーバーはAPI専用サービスであり、UIを持つconsoleとは責務が異なる
   - consoleの変更がMCPに影響を与えるリスク

3. **機能拡張の要件**
   - 公式 `@modelcontextprotocol/server-memory` の機能をリモートMCPとして使用したい
   - 公式実装はローカルJSONLファイル保存のため、Supabaseバックエンドへの変更が必要
   - Supabaseに保存済みのActivity（Toggl, Calendar, Fitbit）データもLLMから利用可能にしたい
   - RAG + KG + Activityを統合した単一のMCPサーバーが望ましい

## 決定

**MCPサーバーを同一リポジトリ内でSupabase Edge Functionsに移行し、RAG・KG・Activityを統合したPersonal Contextシステムを構築する。**

### 新構成（同一リポジトリ）

```
dwhbi/
├── supabase/
│   └── functions/
│       ├── personal-context/           # MCPエンドポイント
│       │   ├── index.ts                # エントリーポイント（Deno.serve）
│       │   ├── server.ts               # MCPプロトコル実装
│       │   ├── auth.ts                 # OAuth トークン検証
│       │   ├── rag/
│       │   │   ├── repository.ts       # Docs検索
│       │   │   ├── embedder.ts         # Voyage embedding（fetch直接）
│       │   │   └── tools.ts
│       │   ├── kg/
│       │   │   ├── repository.ts       # KG操作
│       │   │   └── tools.ts
│       │   └── activity/
│       │       ├── repository.ts       # Activity検索
│       │       └── tools.ts
│       └── _shared/
│           └── supabase.ts             # Supabase client
│
├── packages/console/                   # 既存（MCP部分は削除予定）
│   └── src/
│       ├── app/api/mcp/               # 削除予定
│       └── lib/mcp/                   # 削除予定
│
└── packages/analyzer/                  # 既存
```

### プラットフォーム選択

**Supabase Edge Functions** を採用する。

理由:
- 同一インフラでDB接続が高速（1-10ms vs 50-200ms）
- 認証も同一インフラで高速（Supabase Auth）
- 追加のVercel課金不要
- Denoの高速コールドスタート
- Streamable HTTP（SSE）対応

### 実行時間制約の比較

#### 主要プラットフォーム比較

| プラットフォーム | Free/最小 | Pro/有料 | 最大 | 備考 |
|------------------|-----------|----------|------|------|
| **Vercel Serverless** | 10秒 | 60秒 | 900秒（Enterprise） | `maxDuration`で設定 |
| **Vercel Edge** | 30秒 | 30秒 | 30秒 | CPUバウンド不向き |
| **Supabase Edge** | 150秒（CPU 2秒） | 400秒（CPU 2秒） | 400秒 | CPU制限に注意 |
| **AWS Lambda** | 15分 | 15分 | 15分 | ハードリミット |
| **Google Cloud Run** | 5分（デフォルト） | 60分 | 60分 | 設定で変更可 |
| **Google Cloud Run Jobs** | - | - | **168時間（7日）** | バッチ処理向け |
| **Fly.io** | 制限なし | 制限なし | 制限なし | コンテナベース |
| **Railway** | 制限なし | 制限なし | 制限なし | コンテナベース |
| **Render** | 制限なし | 制限なし | 制限なし | Free tierは15分で停止 |

#### 長時間実行が必要な場合の推奨

| 要件 | 推奨プラットフォーム | 理由 |
|------|---------------------|------|
| **〜60秒** | Vercel Pro | 既存コード移植容易 |
| **〜15分** | AWS Lambda | サーバーレス最長 |
| **〜60分** | Google Cloud Run | 長時間リクエスト対応 |
| **無制限** | Fly.io / Railway | コンテナで常時稼働 |

#### Supabase Edge Functions（詳細）

| リソース | Free | Pro | 備考 |
|----------|------|-----|------|
| Wall Clock Time | 150秒 | 400秒 | Worker全体の生存時間 |
| CPU Time | 2秒 | 2秒 | リクエストあたり（I/O除く） |
| Request Idle Timeout | 150秒 | 150秒 | レスポンスなしでタイムアウト |

**Wall Clock Time vs CPU Time の違い:**

```
リクエスト処理例（Wall Clock 5秒、CPU Time 0.3秒）:
┌──────────────────────────────────────────────────────┐
│ CPU │   DB待ち   │ CPU │  Voyage API待ち  │ CPU │    │
│ 0.1s│    2s      │ 0.1s│      2.5s        │ 0.1s│    │
└──────────────────────────────────────────────────────┘
      ↑             ↑                        ↑
      └─────────────┴────────────────────────┘
              I/O待ち = CPU Timeにカウントされない
```

- **Wall Clock**: 開始から終了までの実時間（5秒）
- **CPU Time**: 実際にCPUが計算している時間（0.3秒）
- **I/O待ち**: DB接続、API呼び出しの待ち時間（CPU Timeに含まれない）

**Supabase Edge の真の強み（同一インフラ）:**

| 観点 | Vercel → Supabase | Supabase Edge → Supabase |
|------|-------------------|--------------------------|
| ネットワーク | インターネット経由 | 内部ネットワーク |
| DB接続レイテンシ | 50-200ms | **1-10ms** |
| コールドスタート | 遅め | 速い（Deno） |
| 追加コスト | Vercel課金 | Supabase課金内 |

ほとんどのMCP操作はI/O待ちが中心（DB読み書き）のため、CPU 2秒制限は実際には問題になりにくい。
むしろ同一インフラによるDB接続の高速化が大きなメリットとなる可能性がある。

#### 比較分析

| 観点 | Vercel Serverless | Supabase Edge | 勝者 |
|------|-------------------|---------------|------|
| **実行時間（Free）** | 10秒 | 150秒（CPU 2秒） | Supabase |
| **実行時間（Pro）** | 60秒 | 400秒（CPU 2秒） | 用途による |
| **コールドスタート** | 遅め | 速い（Deno） | Supabase |
| **Node.js互換性** | 完全 | 部分的（Deno） | Vercel |
| **既存コード移植** | そのまま | 書き換え必要 | Vercel |
| **Supabase連携** | SDK経由 | 直接（同一インフラ） | Supabase |
| **追加コスト** | Vercel課金 | Supabase課金内 | Supabase |

#### MCPサーバーへの影響

| ツール | Wall Clock | 実際のCPU消費 | Supabase Edge |
|--------|------------|---------------|---------------|
| **RAG（既存9ツール）** | | | |
| `search_docs` | 2-5秒 | **0.02-0.05秒** | ✅ OK |
| `get_doc` | 0.5-1秒 | **0.01秒** | ✅ OK |
| `list_tags` | 0.3-0.5秒 | **0.01秒** | ✅ OK |
| `list_docs_by_tag` | 0.3-1秒 | **0.01-0.02秒** | ✅ OK |
| `list_docs_by_date` | 0.3-1秒 | **0.01-0.02秒** | ✅ OK |
| `list_docs_by_frontmatter_date` | 0.3-1秒 | **0.01-0.02秒** | ✅ OK |
| `list_all_docs` | 0.5-1秒 | **0.01-0.02秒** | ✅ OK |
| `search_by_keyword` | 1-3秒 | **0.02-0.05秒** | ✅ OK |
| `search_by_title` | 0.3-1秒 | **0.01-0.02秒** | ✅ OK |
| **KG（新規9ツール）** | | | |
| `kg_create_entities` | 0.5-1秒 | **0.01-0.02秒** | ✅ OK |
| `kg_search` | 0.5-2秒 | **0.01-0.02秒** | ✅ OK |
| `kg_read_graph` | 1-3秒 | **0.02-0.05秒** | ✅ OK |
| その他 kg_* | 0.5-1秒 | **0.01-0.02秒** | ✅ OK |
| **Activity（新規6ツール）** | | | |
| `activity_get_*` | 0.5-2秒 | **0.01-0.02秒** | ✅ OK |
| `activity_summary` | 2-5秒 | **0.05-0.1秒** | ✅ OK |

**全24ツールがCPU 2秒制限内（最大でも0.1秒 = 制限の5%）**

**なぜCPU消費が極めて少ないか:**

```
search_docs の処理フロー:
┌────────────────────────────────────────────────────────────────┐
│ 1. Voyage API呼び出し                                           │
│    await client.embed({...})  → I/O待ち（CPU消費なし）          │
│    └─ Embedding生成はVoyage AIサーバー側で実行                  │
│                                                                  │
│ 2. Supabase RPC呼び出し                                         │
│    await supabase.rpc("search_chunks", {...}) → I/O待ち         │
│    └─ ベクトル演算はPostgreSQLサーバー側で実行                  │
│                                                                  │
│ 3. JSONパース・整形                                              │
│    └─ 唯一のCPU処理（0.01秒程度）                               │
└────────────────────────────────────────────────────────────────┘

結論: すべてが await = 非同期I/O
      重い計算は外部サーバー（Voyage AI, PostgreSQL）で実行
      Edge Function側はJSON処理のみ → CPU 2秒制限は問題にならない
```

#### 推奨: Supabase Edge Functions

**MCPサーバーの処理特性を分析した結果、Supabase Edgeが最適:**

| メリット | 詳細 |
|----------|------|
| **CPU制限は問題なし** | 全ツールがCPU 0.1秒未満（2秒制限の5%以下） |
| **DB接続高速化** | 同一インフラで50-200ms → 1-10msに短縮 |
| **認証も高速** | Token検証がSupabase内部で完結（1-10ms） |
| **コスト効率** | 追加のVercel課金不要（Supabase課金内） |
| **コールドスタート** | Denoは高速起動 |
| **Wall Clock余裕** | Free 150秒、Pro 400秒（十分すぎる） |

**認証フローの比較:**

```
Supabase Edge:
  Token検証: 1-10ms（Supabase Auth = 同一インフラ）
  MCP処理: 直接実行
  合計: 1-10ms + 処理時間

Vercel Middleware + Serverless:
  Middleware Token検証: 50-200ms（Supabase API = インターネット経由）
  Serverless起動: 100-500ms（コールドスタート時）
  MCP処理: 実行
  合計: 150-700ms + 処理時間
```

Supabase Edgeは認証・DB接続・MCP処理すべてが同一インフラで完結するため、
リクエスト全体のレイテンシが大幅に短縮される。

**残る懸念点と対策:**

| 懸念 | 対策 | 難易度 |
|------|------|--------|
| MCP SDK (Node.js) | Deno互換性検証、または直接HTTP実装 | 中 |
| 既存コード書き換え | TypeScript → Deno TypeScript（差分小） | 低 |
| Voyage SDK | fetch APIで直接呼び出し or npm互換 | 低 |

**実装アプローチ:**

```
推奨: 最初からSupabase Edgeで実装

理由:
1. CPU制限が問題にならないことが確認できた
2. DB接続高速化の恩恵を最大限受けられる
3. Vercel課金を避けられる
4. コードベースがシンプル（単一インフラ）
```

### Streamable HTTP（SSE）対応

Supabase Edge FunctionsはReadableStream APIに対応しており、MCPのStreamable HTTPを実装可能。

```typescript
// supabase/functions/personal-context/index.ts
Deno.serve(async (req) => {
  // 認証チェック
  const user = await validateToken(req);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // SSEストリーム作成
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of mcpResponse) {
        const data = `data: ${JSON.stringify(chunk)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
```

### 統合されるMCPツール

#### RAG ツール（既存）

| ツール名 | 説明 | Embedding |
|----------|------|-----------|
| `search_docs` | セマンティック検索 | 要 |
| `get_doc` | ドキュメント全文取得 | 不要 |
| `list_tags` | タグ一覧 | 不要 |
| `list_docs_by_tag` | タグでフィルタ | 不要 |
| `list_docs_by_date` | ファイルパス日付でソート | 不要 |
| `list_docs_by_frontmatter_date` | frontmatter日付でソート | 不要 |
| `list_all_docs` | ページネーション付き一覧 | 不要 |
| `search_by_keyword` | キーワード検索（複数OR） | 不要 |
| `search_by_title` | タイトル部分一致 | 不要 |

#### KG ツール（新規）

公式 `@modelcontextprotocol/server-memory` を参考に、Supabaseバックエンドで実装。
ツール名はKG操作であることを明確にするためリネームする。

| ツール名 | 説明 | 備考 |
|----------|------|------|
| `kg_create_entities` | エンティティ作成（名前、タイプ、観察事項） | |
| `kg_create_relations` | エンティティ間の関係作成（方向付き） | active voice推奨 |
| `kg_add_observations` | エンティティに観察事項を追加 | |
| `kg_delete_entities` | エンティティ削除（関連関係も削除） | |
| `kg_delete_observations` | 観察事項の削除 | |
| `kg_delete_relations` | 関係の削除 | |
| `kg_read_graph` | 全グラフ取得 | |
| `kg_search` | 名前/タイプ/観察事項で検索 | |
| `kg_get_nodes` | 指定エンティティとその関係を取得 | |

**KGデータのソース:**
- LLMとの対話で生まれた事実・関係（`kg_create_*` で直接追加）
- ドキュメントから抽出したエンティティ（analyzer or LLMで抽出 → `kg_create_*`）

両者は同一テーブルに格納され、区別なく検索・利用できる。

#### Activity ツール（新規）

Supabaseに保存済みの行動データへのアクセスを提供。
既存のraw.*テーブルを読み取り専用で参照する。

| ツール名 | 説明 | 対象テーブル |
|----------|------|--------------|
| `activity_get_toggl_entries` | 作業記録を期間・プロジェクト等で取得 | `raw.toggl_entries` |
| `activity_get_calendar_events` | カレンダーイベントを期間で取得 | `raw.google_calendar_events` |
| `activity_get_fitbit_sleep` | 睡眠データを取得 | `raw.fitbit_sleep` |
| `activity_get_fitbit_steps` | 歩数データを取得 | `raw.fitbit_steps` |
| `activity_get_fitbit_heart_rate` | 心拍数データを取得 | `raw.fitbit_heart_rate` |
| `activity_summary` | 指定期間の行動サマリーを取得 | 複合 |

**Activityデータの特徴:**
- 読み取り専用（データはanalyzerパイプラインで収集）
- 時系列データが中心
- ユーザーの行動パターン把握に有用

## ドキュメントからのKG抽出

既存ドキュメントからエンティティ・関係を抽出してKGに格納する方法について検討が必要。

### 抽出アプローチの選択肢

| アプローチ | 説明 | メリット | デメリット |
|------------|------|----------|------------|
| **A. LLM抽出** | LLMにドキュメントを読ませてエンティティ・関係を抽出 | 高精度、文脈理解 | コスト高、処理時間 |
| **B. NER + 関係抽出** | spaCy等でNamed Entity Recognition | 低コスト、高速 | 精度限定、カスタム訓練必要 |
| **C. ハイブリッド** | NERで候補抽出 → LLMで精緻化 | バランス | 実装複雑 |
| **D. オンデマンド** | RAG検索時にLLMがKGを構築 | 必要時のみ処理 | 一貫性なし |

### 推奨: A. LLM抽出（バッチ処理）

既存のanalyzerパイプラインに組み込む形で実装。

```
┌─────────────────────────────────────────────────────────┐
│                    Analyzer Pipeline                     │
├─────────────────────────────────────────────────────────┤
│  1. GitHub → raw.github_contents__documents (既存)                      │
│  2. Markdown解析 → frontmatter抽出 (既存)                │
│  3. チャンク分割 → Embedding → docs_chunks (既存)        │
│  4. 【新規】KG抽出 → kg_entities, kg_relations           │
└─────────────────────────────────────────────────────────┘
```

**KG抽出の実装案:**

```python
# packages/analyzer/src/kg/extractor.py

async def extract_kg_from_document(doc: Document) -> KGExtractionResult:
    """LLMを使ってドキュメントからエンティティと関係を抽出"""

    prompt = f"""
    以下のドキュメントから、重要なエンティティ（人物、概念、場所、イベント等）と
    それらの関係を抽出してください。

    ドキュメント:
    {doc.content}

    出力形式:
    {{
      "entities": [
        {{"name": "...", "type": "person|concept|place|event|...", "observations": ["..."]}}
      ],
      "relations": [
        {{"from": "...", "to": "...", "type": "..."}}  // active voice
      ]
    }}
    """

    # Claude API or OpenAI API
    result = await llm.complete(prompt)
    return parse_kg_result(result)
```

### Embedding の活用可能性

KGにおいてもEmbeddingが有用なケース:

| 用途 | 説明 | Voyage API |
|------|------|------------|
| **エンティティ類似検索** | 「〇〇に似た概念」を検索 | 要 |
| **観察事項のセマンティック検索** | observations内の意味検索 | 要 |
| **関係タイプの正規化** | 類似した関係タイプをクラスタリング | 要 |
| **エンティティ解決** | 同一エンティティの重複検出 | 要 |

**スキーマ拡張案（将来）:**

```sql
-- kg_entities に embedding カラム追加
ALTER TABLE kg_entities ADD COLUMN embedding vector(1024);

-- エンティティ類似検索用インデックス
CREATE INDEX idx_kg_entities_embedding ON kg_entities
  USING ivfflat (embedding vector_cosine_ops);
```

### 実装優先度

1. **Phase 1**: RAG移植 + KGツール基本実装（CRUD）+ Activityツール — Embedding不要（RAGのsearch_docs以外）
2. **Phase 2**: ドキュメントからのLLM抽出（analyzer統合）
3. **Phase 3**: エンティティEmbedding追加（類似検索強化）

Phase 1ではLLM対話からの直接KG作成と、既存Activityデータの参照に対応。ドキュメント抽出は後続フェーズで実装する。

## Supabaseスキーマ設計

### KGテーブル

```sql
-- Entities: ナレッジグラフのノード
CREATE TABLE kg_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  observations TEXT[] NOT NULL DEFAULT '{}',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, user_id)
);

-- Relations: ノード間の有向エッジ
CREATE TABLE kg_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(from_entity, to_entity, relation_type, user_id)
);

-- インデックス
CREATE INDEX idx_kg_entities_user_id ON kg_entities(user_id);
CREATE INDEX idx_kg_entities_name ON kg_entities(name);
CREATE INDEX idx_kg_entities_type ON kg_entities(entity_type);
CREATE INDEX idx_kg_relations_user_id ON kg_relations(user_id);
CREATE INDEX idx_kg_relations_from ON kg_relations(from_entity);
CREATE INDEX idx_kg_relations_to ON kg_relations(to_entity);
CREATE INDEX idx_kg_entities_observations ON kg_entities USING GIN(observations);

-- RLS有効化
ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relations ENABLE ROW LEVEL SECURITY;

-- RLSポリシー（ユーザーは自分のデータのみアクセス可能）
CREATE POLICY "Users can CRUD own entities" ON kg_entities
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own relations" ON kg_relations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### 既存テーブル（変更なし）

- `raw.github_contents__documents` - ドキュメント本体
- `public.docs_chunks` - チャンク＋embedding
- `search_chunks` RPC - ベクトル検索
- `list_all_tags` RPC - タグ一覧
- `list_docs_by_date` RPC - 日付検索
- `list_docs_by_frontmatter_date` RPC - frontmatter日付検索

## OAuth認証

既存のSupabase OAuth Server設定を共有する。

### エンドポイント設定

新しいVercelプロジェクトをデプロイ後:

1. **Supabase OAuth App作成**
   - Redirect URI: `https://mcp.example.com/callback`（Claudeが使用）

2. **OAuth Protected Resource メタデータ**
   ```typescript
   // /.well-known/oauth-protected-resource
   {
     "resource": "https://mcp.example.com/api/mcp",
     "authorization_servers": ["https://xxx.supabase.co/auth/v1"],
     "scopes_supported": ["profile", "email"],
     "bearer_methods_supported": ["header"]
   }
   ```

3. **認証フロー**
   - Claude → MCPエンドポイント（401応答）
   - Claude → Supabase OAuth → 認証
   - Claude → MCPエンドポイント（Bearer token付き）

### トークン検証

```typescript
async function validateAccessToken(request: Request): Promise<{ valid: boolean; userId?: string }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const token = authHeader.substring(7);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { valid: false };
  }

  return { valid: true, userId: user.id };
}
```

## 環境変数

### Supabase Edge Functions

| 環境変数 | 用途 | 備考 |
|----------|------|------|
| `SUPABASE_URL` | Supabase接続 | 自動設定 |
| `SUPABASE_ANON_KEY` | Supabase匿名キー | 自動設定 |
| `VOYAGE_API_KEY` | Voyage AI embedding | Supabase Secrets |

### consoleから削除

MCPエンドポイント移行後、以下を削除:
- `packages/console/src/app/api/mcp/` ルート
- `packages/console/src/lib/mcp/` ディレクトリ
- `@modelcontextprotocol/sdk` 依存（package.json）

## 移行計画

### Phase 1: Supabase Edge Function作成 ✅ 完了

1. ✅ `supabase/functions/personal-context/` 作成
2. ✅ 既存RAGツールをDeno TypeScriptに移植（9ツール全て）
3. ✅ MCPプロトコル実装（JSON-RPC + SSE対応）
4. ✅ 認証処理実装（Supabase Auth + service-role bypass）
5. ⚠️ ローカルテスト（Docker未稼働のためスキップ）
6. ✅ デプロイ（`supabase functions deploy personal-context --no-verify-jwt`）

### Phase 2: KG・Activity機能追加 📋 未着手

1. Supabase migrationでKGテーブル作成（`kg_entities`, `kg_relations`）
2. kg repository実装
3. kg tools実装（`kg_*`）
4. activity repository実装（既存raw.*テーブル参照）
5. activity tools実装（`activity_*`）

### Phase 3: OAuth設定更新 ✅ 完了

1. ✅ OAuth Protected Resource メタデータ更新（`resource` → Edge Function URL）
2. ✅ `WWW-Authenticate` ヘッダーにVercelのmetadata URLを設定
3. ✅ Claude カスタムコネクタ更新（MCP URL変更）
4. ✅ 動作確認（全9ツール正常動作）

### Phase 4: console側クリーンアップ ✅ 完了

1. ✅ `/api/mcp` ルート削除
2. ✅ `/lib/mcp/` ディレクトリ削除
3. ✅ MCP関連依存削除（`@modelcontextprotocol/sdk`, `voyageai`）
4. ✅ 認証関連は保持（`/auth/consent/`, `/.well-known/oauth-protected-resource/`）

## メリット

1. **パフォーマンス向上**
   - DB接続: 50-200ms → 1-10ms（同一インフラ）
   - 認証: 50-200ms → 1-10ms（同一インフラ）
   - コールドスタート: 高速（Deno）

2. **デプロイ独立性**
   - MCPツール変更時は`supabase functions deploy`のみ
   - console再デプロイ不要

3. **コスト効率**
   - Vercel課金不要（Supabase課金内）
   - 同一インフラで管理

4. **関心の分離**
   - MCP = Supabase Edge Function
   - console = UI + 管理機能

5. **KG機能**
   - 公式memory MCPと同等の機能をリモートで利用可能
   - Supabaseによるデータ永続化・ユーザー分離

6. **Activity機能**
   - 既存の行動データ（Toggl, Calendar, Fitbit）をLLMから直接参照可能

## デメリット

1. **Deno移植コスト**
   - 既存Node.jsコードの書き換え必要
   - MCP SDKのDeno互換性検証または直接実装

2. **学習コスト**
   - Deno/Supabase Edge Functionsの学習

3. **デバッグ**
   - ローカル開発環境の構築（`supabase start`）

## 代替案

### 案A: consoleに統合維持（却下）

- メリット: 作業不要
- デメリット: デプロイ非効率、関心の混在、パフォーマンス劣る

### 案B: 別リポジトリ + Vercel（却下）

- メリット: 既存コードそのまま
- デメリット: リポジトリ増加、Vercel課金、DB接続遅い

### 案C: 別リポジトリ + Supabase Edge（却下）

- メリット: Supabase Edge の利点を享受
- デメリット: リポジトリ増加、認証設定の重複

→ **同一リポジトリ + Supabase Edge を採用**

理由:
- リポジトリ増加なし
- 既存のSupabase設定を流用可能
- DB接続・認証が最速
- コスト効率最高

## 関連ドキュメント

- [MCP Personal Knowledge設計](../mcp-personal-knowledge-design.md)
- [ADR-009 Console データベースアクセス方式](./adr_009-console-database-access.md)
- [公式 @modelcontextprotocol/server-memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

## Sources

- [GitHub - modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- [Knowledge Graph Memory MCP Server](https://www.pulsemcp.com/servers/modelcontextprotocol-knowledge-graph-memory)
- [Supabase Edge Functions Limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Edge Functions Streaming](https://supabase.com/docs/guides/functions/examples/elevenlabs-generate-speech-stream)
