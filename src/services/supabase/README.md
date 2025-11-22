# Supabase スキーマ定義

各サービス用のテーブル・ビュー・RLS定義を集約したSQLファイル群。

> **Note**: Zaim スキーマは Supabase CLI マイグレーションに移行しました。
> → [`supabase/migrations/`](../../../supabase/migrations/)

---

## ファイル一覧

### Toggl（時間管理）

| ファイル | 説明 |
|----------|------|
| `create_toggl_clients.sql` | クライアントマスタ |
| `create_toggl_projects.sql` | プロジェクトマスタ |
| `create_toggl_time_entries.sql` | タイムエントリ |

### Fitbit / Tanita（健康データ）

| ファイル | 説明 |
|----------|------|
| `create_fitbit_tokens.sql` | Fitbit OAuth トークン |
| `create_tanita_tokens.sql` | Tanita OAuth トークン |
| `create_health_data_*.sql` | 各種健康データテーブル |
| `create_view_*.sql` | 集計ビュー |

### 共通

| ファイル | 説明 |
|----------|------|
| `setup_rls.sql` | Row Level Security 設定 |

---

## 実行方法

### Supabase Dashboard から実行（レガシー）

1. Supabase Dashboard にログイン
2. 対象プロジェクトを選択
3. SQL Editor を開く
4. SQLファイルの内容をコピー＆ペースト
5. Run を実行

### Supabase CLI から実行（推奨）

新規スキーマは `supabase/migrations/` にマイグレーションとして作成してください。

```bash
# マイグレーション作成
npx supabase migration new <name>

# ローカルで検証
npx supabase start

# リモートに適用
npx supabase db push
```

---

## 注意事項

- **実行順序**: 外部キー制約があるため、マスタテーブル → トランザクションテーブルの順で実行
- **冪等性**: `IF NOT EXISTS` を使用しているため、再実行しても安全
- **RLS**: 現時点では `service_role_key` を使用するため無効化。ユーザー認証導入時に有効化

---

## スキーマ構成

```
Supabase
├── public スキーマ（デフォルト）
│   ├── toggl_* テーブル
│   ├── health_data_* テーブル
│   ├── *_tokens テーブル
│   └── zaim_* ビュー（zaimスキーマへの参照）
│
└── zaim スキーマ（専用）← supabase/migrations/ で管理
    ├── categories
    ├── genres
    ├── accounts
    ├── transactions
    ├── sync_log
    └── monthly_summary（マテリアライズドビュー）
```

---

## 今後の方針

このフォルダ内のSQLファイルは順次 `supabase/migrations/` に移行予定です。
