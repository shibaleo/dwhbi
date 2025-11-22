# テストスイート

## 概要

Deno テストランナーを使用した単体テストと、手動確認スクリプトで構成されています。

## クイックスタート

```bash
# 全サービスの単体テストを実行
deno task test

# 全サービスの環境確認（API疎通・DB確認、書き込みなし）
deno task check

# 全サービスの同期確認（⚠️ DB書き込みあり）
deno task check:sync
```

## タスク一覧

### 単体テスト（`deno task test:*`）

環境変数不要。純粋関数のテスト。

| コマンド | 用途 |
|---------|------|
| `deno task test` | 全サービス |
| `deno task test:fitbit` | Fitbit |
| `deno task test:gcalendar` | Google Calendar |
| `deno task test:tanita` | Tanita |
| `deno task test:toggl` | Toggl |
| `deno task test:zaim` | Zaim |
| `deno task test:watch` | ファイル変更時に自動再実行 |
| `deno task test:coverage` | カバレッジ付き |

### 環境確認（`deno task check:*`）

環境変数必要。API疎通・DB内容確認。

| コマンド | 用途 | DB書き込み |
|---------|------|-----------|
| `deno task check` | 全サービス一括 | なし |
| `deno task check:sync` | 全サービス一括 | **あり** |
| `deno task check:fitbit` | Fitbit | なし |
| `deno task check:fitbit:sync` | Fitbit | **あり** |
| `deno task check:gcalendar` | Google Calendar | なし |
| `deno task check:gcalendar:sync` | Google Calendar | **あり** |
| `deno task check:tanita` | Tanita | なし |
| `deno task check:tanita:sync` | Tanita | **あり** |
| `deno task check:toggl` | Toggl | なし |
| `deno task check:toggl:sync` | Toggl | **あり** |
| `deno task check:zaim` | Zaim | なし |
| `deno task check:zaim:sync` | Zaim | **あり** |

### 本番同期（`deno task sync:*`）

GitHub Actionsで自動実行される日次同期スクリプト。

| コマンド | 用途 |
|---------|------|
| `deno task sync:fitbit` | Fitbit同期 |
| `deno task sync:gcalendar` | Google Calendar同期 |
| `deno task sync:tanita` | Tanita同期 |
| `deno task sync:toggl` | Toggl同期 |
| `deno task sync:zaim` | Zaim同期 |

## ディレクトリ構成

```
test/
├── README.md              # このファイル
├── run_tests.ts           # テストランナー（レガシー）
├── fitbit/
│   ├── README.md
│   ├── *.test.ts          # 単体テスト（deno test対象）
│   ├── check_all.ts       # 一括確認スクリプト
│   └── check_*.ts         # 個別確認スクリプト
├── gcalendar/
├── tanita/
├── toggl/
└── zaim/
```

## ファイル命名規則

| パターン | 用途 | 実行方法 |
|----------|------|----------|
| `*.test.ts` | 単体テスト（純粋関数） | `deno test` で自動実行 |
| `check_all.ts` | 一括確認 | `deno task check:{service}` |
| `check_*.ts` | 個別確認 | `deno run` で手動実行 |

## テスト件数サマリー

| サービス | api | auth | fetch_data | write_db | 合計 |
|----------|-----|------|------------|----------|------|
| fitbit | 6 | 10 | 10 | 24 | **50** |
| tanita | 11 | 10 | 10 | 19 | **50** |
| toggl | 11 | - | - | 13 | **24** |
| zaim | - | - | - | 12 | **12** |
| gcalendar | - | - | - | 18 | **18** |
| **合計** | 28 | 20 | 20 | 86 | **154** |

## テスト方針

### 対象の選定基準

| 種類 | 採用 | 理由 |
|------|------|------|
| 単体テスト（純粋関数） | ✅ | 回帰検知に有効、実装コスト低 |
| 統合テスト | ❌ | モック作成の工数が大きい |
| 手動確認スクリプト | ✅ | 実環境での動作確認に実用的 |

### モジュール別パターン

| モジュール | テスト対象 |
|------------|------------|
| `types.ts` | - （型定義のみ） |
| `api.ts` | 日付フォーマット、範囲計算などの純粋関数 |
| `auth.ts` | トークン有効期限チェック関数 |
| `fetch_data.ts` | データ変換関数、期間分割関数 |
| `write_db.ts` | API→DB変換関数（`toDb*`） |
| `sync_*.ts` | - （オーケストレーター、手動確認のみ） |

## コードスタイル規約

### 手動確認スクリプト（`check_*.ts`）

```typescript
// ファイルヘッダー
// test/{service}/check_xxx.ts
// 説明文
//
// 実行方法:
//   deno run --allow-env --allow-net --allow-read test/{service}/check_xxx.ts

// import（jsr形式を使用）
import "jsr:@std/dotenv/load";
import { ... } from "../../src/services/{service}/xxx.ts";

// main関数でラップ
async function main() {
  console.log("=".repeat(60));
  console.log("タイトル");
  console.log("=".repeat(60));

  try {
    // 処理

    console.log("\n" + "=".repeat(60));
    console.log("✅ 成功メッセージ");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ エラー:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

main();
```

### 規約まとめ

| 項目 | 規約 |
|------|------|
| import形式 | `jsr:@std/dotenv/load` |
| 実行構造 | `async function main()` でラップ |
| 区切り線 | 60文字（`"=".repeat(60)`） |
| 終了コード | 成功=0（デフォルト）、失敗=1 |
| 絵文字 | ✅成功、❌エラー、📋情報、🔑認証、📥取得、📤書込 |

## 環境変数

単体テスト（`*.test.ts`）は**環境変数不要**で実行可能です。

手動確認スクリプト（`check_*.ts`）には各サービスのAPI認証情報とSupabase接続情報が必要です。
詳細は各サービスの README.md を参照してください。

## CI/CD

GitHub Actions で自動実行する場合:

```yaml
- name: Run tests
  run: deno task test
```
