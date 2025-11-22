# Fitbit 手動テスト

実際のAPIとDBを使った統合テスト。CIではなく手動で実行する。

## 必要な環境変数

`.env`または環境変数として設定：

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
FITBIT_CLIENT_ID=xxxxx
FITBIT_CLIENT_SECRET=xxxxx
```

## テストスクリプト

### 1. 認証テスト (`test_auth.ts`)

DBのトークン取得・有効性確認をテスト。

```bash
deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_auth.ts
```

### 2. データ取得テスト (`test_fetch.ts`)

Fitbit APIからのデータ取得をテスト（DBには書き込まない）。

```bash
# デフォルト3日間
deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_fetch.ts

# 日数指定
FITBIT_TEST_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_fetch.ts
```

### 3. 同期テスト (`test_sync.ts`)

⚠️ **実際にDBに書き込む**

```bash
# デフォルト3日間
deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync.ts

# 日数指定
FITBIT_SYNC_DAYS=7 deno run --allow-env --allow-net --allow-read test/fitbit/manual/test_sync.ts
```

### 4. DB確認 (`check_db.ts`)

現在のDB内容を確認。

```bash
deno run --allow-env --allow-net --allow-read test/fitbit/manual/check_db.ts
```

## 推奨実行順序

1. `test_auth.ts` - 認証が通るか確認
2. `test_fetch.ts` - APIからデータが取れるか確認
3. `check_db.ts` - 現在のDB状態を確認
4. `test_sync.ts` - 同期を実行
5. `check_db.ts` - 同期後のDB状態を確認

## レート制限に関する注意

- Fitbit APIのレート制限: **150リクエスト/時間**
- `test_fetch.ts`は1日あたり約10リクエスト消費
- 3日間テストで約30リクエスト
- 連続テスト時は注意

## トラブルシューティング

### トークンが期限切れ

```
❌ リフレッシュエラー: 401 - {"errors":[{"errorType":"expired_token"...}]}
```

→ 手動で新しいトークンを取得し、`fitbit.tokens`テーブルを更新してください。

### レート制限に達した

```
❌ Fitbit API エラー: 429 - Too Many Requests
```

→ 1時間待つか、翌日に再実行してください。

### スコープ不足

```
❌ Fitbit API エラー: 403 - {"errors":[{"errorType":"insufficient_scope"...}]}
```

→ OAuth認可時に必要なスコープを含めてください：
```
activity heartrate location nutrition oxygen_saturation profile respiratory_rate settings sleep social temperature weight
```
