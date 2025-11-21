# Fitbit Data Fetcher

既存の設計を踏襲しつつ、責任ごとにファイルを分割した実装です。

## ファイル構造
```
.
├── types.ts                   # 型定義
├── cache.ts                   # キャッシュ操作
├── fetch.ts                   # Fitbit API呼び出し（内部用）
├── api.ts                     # 外部向けインターフェース
├── fetch_fitbit_data.ts       # CLIエントリーポイント（手動実行用）
├── example.ts                 # 使用例
└── refresh_fitbit_token.ts    # トークンリフレッシュ（既存）
```

## 各ファイルの役割

### `types.ts`
型定義のみを提供します。

- `DateRange` - 日付範囲
- `FitbitAllScopeData` - 取得データの構造
- `CachedAllScopeData` - キャッシュファイルの構造
- `FitbitTokenData` - トークン情報

### `cache.ts`
キャッシュファイルの読み書きを担当します。

**主要関数:**
- `getCacheFilePath(range)` - キャッシュファイルパスを生成
- `checkCacheExists(range)` - キャッシュの存在確認
- `loadCachedData(range)` - キャッシュから読み込み
- `saveCachedData(range, data)` - キャッシュに保存
- `checkAllCachesExist(ranges)` - 複数チャンクの一括確認

### `fetch.ts`
Fitbit APIへの実際のアクセスを担当します（内部用）。

**主要関数:**
- `splitDateRangeBy90Days(start, end)` - 90日チャンクに分割
- `fetchFitbitData(start, end, options)` - データ取得のメイン関数
  - トークン取得あり
  - グループ化された並行リクエスト（5グループ、各グループ間1.5秒待機）
  - レート制限対応

**取得エンドポイント:**
- Sleep（睡眠）
- Heart Rate（心拍数）
- Activity（歩数、距離、カロリー、階数、標高、活動時間）
- Body Weight（体重）
- Body Fat（体脂肪率/BMI）
- SpO2（血中酸素濃度）

### `api.ts`
**外部向けのメインインターフェース**です。Supabase同期処理などから呼ばれます。

**主要関数:**
- `getFitbitData(start, end)` - キャッシュ優先の取得関数
  - キャッシュがある → 即座に返す（トークン取得なし）
  - キャッシュがない → `fetchFitbitData()`を呼び出す

### `fetch_fitbit_data.ts`
CLIエントリーポイントです。手動実行やスケジュール実行から呼ばれます。

## 使い方

### 1. CLI実行（手動・スケジュール用）
```bash
# 過去7日間を取得
deno run --allow-all fetch_fitbit_data.ts

# 特定の日を取得
deno run --allow-all fetch_fitbit_data.ts 2025-01-15

# 期間を指定して取得
deno run --allow-all fetch_fitbit_data.ts 2023-01-01 2025-01-31

# キャッシュを無視して強制取得
deno run --allow-all fetch_fitbit_data.ts --force 2025-01-01 2025-01-31
```

### 2. プログラムから呼び出し（Supabase同期処理など）
```typescript
import { getFitbitData } from "./api.ts";

// キャッシュ優先で取得（高速）
const data = await getFitbitData("2025-01-01", "2025-01-31");

// Supabaseに同期
await syncToSupabase(data);
```

### 3. 強制的にAPI取得したい場合
```typescript
import { fetchFitbitData } from "./fetch.ts";

// キャッシュを無視して強制取得
const data = await fetchFitbitData("2025-01-01", "2025-01-31", { 
  forceRefresh: true 
});
```

## 設計思想

### キャッシュ戦略
- 90日チャンクごとにキャッシュファイルを生成
- `./cache/fitbit_YYYY-MM-DD_YYYY-MM-DD.json` 形式
- キャッシュがあれば即座に返す（トークン取得不要）

### レート制限対応
- Fitbit APIの制限: 1時間150リクエスト/ユーザー
- 短時間バースト制限を回避するため、5グループに分割
- 各グループ間に1.5秒の待機時間
- 1チャンクあたり約7.5秒で取得（元の順次版の約8倍速）

### データ取得フロー

**外部から呼び出す場合（推奨）:**
```
getFitbitData() 
  ↓
キャッシュ確認
  ↓ キャッシュあり
キャッシュから読み込み（高速・トークン不要）
  ↓ キャッシュなし
fetchFitbitData()
  ↓
Fitbit API呼び出し
  ↓
キャッシュに保存
```

**CLI実行の場合:**
```
fetch_fitbit_data.ts
  ↓
fetchFitbitData()
  ↓
トークン取得
  ↓
90日チャンクに分割
  ↓
各チャンクを取得（キャッシュまたはAPI）
```

## パフォーマンス比較

- **完全並行版**（19個同時）: 0.5秒 → レート制限でブロック ❌
- **順次版**（1個ずつ）: 約40-60秒 → 安全だが遅い
- **グループ化版**（5グループ）: 約7.5秒 → 安全で高速 ✅

## 今後の拡張

### Supabase同期処理を追加する場合
```typescript
// sync_to_supabase.ts
import { getFitbitData } from "./api.ts";

async function syncToSupabase(startDate: string, endDate: string) {
  // キャッシュ優先で取得
  const data = await getFitbitData(startDate, endDate);
  
  // Supabaseに保存
  // ... 実装
}
```

### スケジュール実行（GitHub Actions）
```yaml
# .github/workflows/fetch-fitbit.yml
- name: Fetch Fitbit Data
  run: deno run --allow-all fetch_fitbit_data.ts
```

## 注意事項

- `refresh_fitbit_token.ts` は既存のファイルで、トークンリフレッシュを担当します
- キャッシュディレクトリ `./cache/` は自動作成されます
- レート制限に達した場合、1時間待機が必要です