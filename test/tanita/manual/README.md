# Tanita 手動テスト

実際のAPIとDBを使った統合テスト。CIではなく手動で実行する。

## 必要な環境変数

`.env`または環境変数として設定：

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
TANITA_CLIENT_ID=xxxxx
TANITA_CLIENT_SECRET=xxxxx
```

## テストスクリプト

### 1. 認証テスト (`test_auth.ts`)

DBのトークン取得・有効性確認をテスト。

```bash
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_auth.ts
```

### 2. データ取得テスト (`test_fetch.ts`)

Tanita APIからのデータ取得をテスト（DBには書き込まない）。

```bash
# デフォルト7日間
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_fetch.ts

# 日数指定
TANITA_TEST_DAYS=30 deno run --allow-env --allow-net --allow-read test/tanita/manual/test_fetch.ts
```

### 3. 同期テスト (`test_sync.ts`)

⚠️ **実際にDBに書き込む**

```bash
# デフォルト3日間
deno run --allow-env --allow-net --allow-read test/tanita/manual/test_sync.ts

# 日数指定
TANITA_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/tanita/manual/test_sync.ts
```

### 4. DB確認 (`check_db.ts`)

現在のDB内容を確認。

```bash
deno run --allow-env --allow-net --allow-read test/tanita/manual/check_db.ts
```

## 推奨実行順序

1. `test_auth.ts` - 認証が通るか確認
2. `test_fetch.ts` - APIからデータが取れるか確認
3. `check_db.ts` - 現在のDB状態を確認
4. `test_sync.ts` - 同期を実行
5. `check_db.ts` - 同期後のDB状態を確認
