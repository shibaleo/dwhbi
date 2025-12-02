---
title: Tanita Health Planet 同期モジュール詳細設計
---


| 項目 | 内容 |
|------|------|
| ドキュメントバージョン | 1.1.0 |
| 最終更新日 | 2025-12-01 |
| 対象ファイル | `pipelines/services/tanita.py` |
| ステータス | 実装完了・テスト済み（24/24テスト成功） |

## 1. 概要

### 1.1 目的

Tanita Health Planet API から体組成データ・血圧データを取得し、Supabase の `raw` スキーマに保存する Python モジュール。

### 1.2 スコープ

- OAuth 2.0認証管理（自動トークンリフレッシュ）
- 2種類のデータ型同期（体組成、血圧）
- 日次バッチ処理（GitHub Actions から実行予定）
- raw 層への生データ保存（staging 以降の変換は別モジュール）

### 1.3 用語定義

| 用語 | 説明 |
|------|------|
| Health Planet | タニタの健康管理サービス |
| 体組成 | 体重・体脂肪率などの測定データ (innerscan) |
| 血圧 | 最高血圧・最低血圧・脈拍の測定データ (sphygmomanometer) |
| keydata | APIレスポンスの測定値フィールド |
| tag | 測定項目を識別するコード（6021=体重、622E=最高血圧など） |

## 2. 前提条件・制約

### 2.1 実行環境

| 項目 | 要件 |
|------|------|
| Python | 3.12 以上 |
| OS | Windows / Linux / macOS |
| タイムゾーン | Windows環境では tzdata パッケージ必須 |
| ネットワーク | Health Planet API、Supabase への HTTPS 接続が必要 |

### 2.2 外部サービス依存

| サービス | 用途 | レート制限 |
|---------|------|-----------|
| Tanita Health Planet API | データ取得元 | 明示的な記載なし |
| Supabase | データ保存先 | プランによる |

### 2.3 前提条件

1. `.env` ファイルに環境変数が設定されていること
2. `credentials.services` テーブルに Tanita OAuth 2.0 認証情報が保存されていること
3. `raw.tanita_*` テーブルが作成済みであること
4. 初回OAuth認証が完了し、refresh_tokenが取得済みであること

### 2.4 制限事項

| 制限 | 説明 | 回避策 |
|------|------|--------|
| データ取得制限 | 3ヶ月/リクエスト | チャンク処理で対応 |
| 日付フォーマット | リクエスト14桁、レスポンス12桁 | format/parse関数で変換 |
| 文字エンコーディング | Shift_JIS応答の可能性 | エンコーディング自動検出で対応 |
| 廃止された測定項目 | 体組成タグ6023-6029は2020/6/29で終了 | 6021, 6022のみ使用 |

## 3. アーキテクチャ

### 3.1 モジュール構成図

```
┌────────────────────────────────────────────────────────────────┐
│                       sync_tanita()                            │
│                    メインエントリーポイント                       │
└────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ get_access_token │ │  fetch_*_data   │ │    upsert_*      │
│   OAuth管理      │ │  API取得関数群   │ │  DB書き込み関数群 │
└──────────────────┘ └─────────────────┘ └──────────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌──────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ refresh_token_   │ │   to_db_*       │ │ Supabase raw.*   │
│ from_api         │ │  変換関数群      │ │  (PostgreSQL)    │
└──────────────────┘ └─────────────────┘ └──────────────────┘
          │                   │
          ▼                   ▼
┌──────────────────┐ ┌─────────────────┐
│ Health Planet    │ │ Health Planet   │
│ OAuth API        │ │ Data API        │
└──────────────────┘ └─────────────────┘
```

### 3.2 レイヤ構成

```
pipelines/
├── services/
│   └── tanita.py          # 本モジュール（Tanita専用ロジック、約720行）
└── lib/
    ├── credentials.py     # 認証情報の取得・復号・更新
    ├── db.py              # Supabaseクライアント
    ├── encryption.py      # AES-GCM暗号化
    └── logger.py          # ロギング設定
```

## 4. データフロー

### 4.1 処理シーケンス

```
1. sync_tanita(days=3) 呼び出し
   │
   ├─ 2. get_access_token()
   │   ├─ キャッシュチェック（グローバル変数 _auth_cache）
   │   ├─ 有効期限チェック（30分閾値）
   │   └─ 必要時 refresh_token_from_api()
   │
   ├─ 3. 期間設定（JST 00:00:00基準）
   │   └─ generate_periods()で3ヶ月ごとに分割
   │
   ├─ 4. データ取得（逐次処理、レート制限考慮）
   │   ├─ fetch_body_composition()   # 体組成
   │   │   └─ 0.5秒待機
   │   └─ fetch_blood_pressure()     # 血圧
   │       └─ 1秒待機（複数期間時）
   │
   ├─ 5. データ変換
   │   ├─ to_db_body_composition()
   │   └─ to_db_blood_pressure()
   │
   └─ 6. DB保存
       ├─ upsert_body_composition()
       └─ upsert_blood_pressure()
```

### 4.2 タイムゾーン変換の流れ

```
Health Planet API
   │ 12桁文字列（TZ情報なし、JST想定）
   │ 例: "202511301530"
   ▼
parse_tanita_date()
   │ 1. strptime("%Y%m%d%H%M")でパース
   │ 2. ZoneInfo("Asia/Tokyo")でJSTとして解釈
   │ 3. .astimezone(timezone.utc)でUTCに変換
   │ 4. .isoformat()でISO8601文字列化
   ▼
Supabase
   │ timestamptz型として保存
   │ 例: "2025-11-30T06:30:00+00:00"
```

### 4.3 測定データのグループ化

```
API Response (複数タグが個別レコード)
   │
   │ [
   │   {"date": "202511301530", "tag": "6021", "keydata": "70.5"},
   │   {"date": "202511301530", "tag": "6022", "keydata": "18.5"},
   │   {"date": "202511291030", "tag": "6021", "keydata": "71.0"}
   │ ]
   │
   ▼
to_db_body_composition()
   │ 同一日時のタグをグループ化
   │
   ▼
DB Records (日時ごとに1レコード)
   │
   │ [
   │   {"measured_at": "...", "weight": 70.5, "body_fat_percent": 18.5},
   │   {"measured_at": "...", "weight": 71.0, "body_fat_percent": None}
   │ ]
```

## 5. 設計判断（ADR）

### ADR-001: OAuth 2.0 トークン管理戦略

**決定**: メモリキャッシュ + 30分閾値で自動リフレッシュ

**理由**:
- Tanita OAuth 2.0トークンの有効期限は3時間
- 安全マージンとして30分前にリフレッシュ
- グローバル変数 `_auth_cache` でプロセス内キャッシュ
- GitHub Actions実行では毎回プロセス再起動されるため、初回にリフレッシュ判定

**代替案**:
- DBにトークンとexpires_atを保存して管理 → 採用（credentials.servicesテーブル）
- 毎回リフレッシュ → API負荷増

**トレードオフ**:
- OK: API呼び出し削減
- 注意: プロセス長時間起動時のトークン失効リスク（現状は日次バッチなので問題なし）

### ADR-002: チャンク処理の採用

**決定**: 3ヶ月（90日）ごとにAPI呼び出しを分割

**理由**:
- Health Planet APIは3ヶ月/リクエストの制限
- `generate_periods()` で期間を自動分割

**実装**:
```python
def generate_periods(start: datetime, end: datetime, max_days: int = 90) -> list[tuple[datetime, datetime]]:
    """期間を最大日数ごとに分割"""
```

**代替案**:
- 1ヶ月ずつ取得 → API呼び出し過多

**トレードオフ**:
- OK: API呼び出し最小化
- 注意: 大量期間取得時のレスポンスサイズ増

### ADR-003: 逐次データ取得

**決定**: 体組成→血圧の順に逐次取得（並列なし）

**理由**:
- Health Planet APIのレート制限が明示されていない
- 控えめな実装で安定性を優先
- 各リクエスト間に0.5〜1秒の待機

**代替案**:
- 並列取得 → レート制限リスク

**トレードオフ**:
- OK: API制限リスク回避
- 注意: 処理時間増（数秒程度）

### ADR-004: Shift_JISエンコーディング対応

**決定**: Content-Typeヘッダーとフォールバックで自動判定

**理由**:
- Health Planet APIはShift_JISでレスポンスを返す場合がある
- UTF-8でデコード失敗時にShift_JISを試行

**実装**:
```python
def _parse_api_response(response: httpx.Response) -> dict:
    content_type = response.headers.get("content-type", "")
    if "shift_jis" in content_type.lower():
        content = response.content.decode("shift_jis")
        data = json.loads(content)
    else:
        try:
            data = response.json()
        except UnicodeDecodeError:
            content = response.content.decode("shift_jis")
            data = json.loads(content)
```

**トレードオフ**:
- OK: 様々なエンコーディングに対応
- 注意: デコード処理のオーバーヘッド（微小）

### ADR-005: 日付フォーマットの使い分け

**決定**: リクエスト14桁、レスポンス12桁を別関数で処理

**理由**:
- API仕様書より:
  - リクエストパラメータ: `yyyyMMddHHmmss` (14桁)
  - レスポンスデータ: `yyyyMMddHHmm` (12桁)

**実装**:
```python
def format_tanita_date(dt: datetime) -> str:
    """datetimeをTanita API形式（14桁）に変換"""
    return dt.strftime("%Y%m%d%H%M%S")

def parse_tanita_date(date_str: str) -> str:
    """Tanita日付（12桁）をISO8601 UTCに変換"""
    if len(date_str) == 12:
        dt_naive = datetime.strptime(date_str, "%Y%m%d%H%M")
    elif len(date_str) == 14:
        dt_naive = datetime.strptime(date_str, "%Y%m%d%H%M%S")
```

**トレードオフ**:
- OK: API仕様に正確に対応
- 注意: 2つの形式を理解する必要あり

### ADR-006: 測定タグの限定

**決定**: 体組成は6021, 6022のみ、血圧は622E, 622F, 6230を使用

**理由**:
- 体組成タグ6023-6029は2020/6/29で連携終了（API仕様書より）
- 現在取得可能なのは体重(6021)と体脂肪率(6022)のみ
- 血圧は最高血圧(622E)、最低血圧(622F)、脈拍(6230)の3点セット

**実装**:
```python
BODY_COMPOSITION_TAG_MAP = {
    "6021": "weight",           # 体重 (kg)
    "6022": "body_fat_percent", # 体脂肪率 (%)
}

BLOOD_PRESSURE_TAG_MAP = {
    "622E": "systolic",   # 最高血圧 (mmHg)
    "622F": "diastolic",  # 最低血圧 (mmHg)
    "6230": "pulse",      # 脈拍 (bpm)
}
```

**トレードオフ**:
- OK: 現行仕様に正確に対応
- 注意: 将来タグ追加時は手動更新必要

## 6. データ型定義

### 6.1 API型

```python
class TanitaApiMeasurement(TypedDict):
    """Tanita API測定データ（1レコード）

    API仕様書より:
    - date: 測定日付 (yyyyMMddHHmm) - 12桁
    - keydata: 測定データ（値）
    - model: 測定機器名
    - tag: 測定部位
    """
    date: str      # yyyyMMddHHmm (12桁)
    keydata: str   # 測定データ（値）
    model: str     # 測定機器名
    tag: str       # 測定部位タグ
```

### 6.2 DB型

```python
class DbBodyComposition(TypedDict):
    """DB保存用体組成データ

    DBスキーマ: raw.tanita_body_composition
    """
    measured_at: str           # ISO8601 UTC
    weight: float | None       # 体重 (kg)
    body_fat_percent: float | None  # 体脂肪率 (%)
    model: str
    synced_at: str

class DbBloodPressure(TypedDict):
    """DB保存用血圧データ

    DBスキーマ: raw.tanita_blood_pressure
    """
    measured_at: str           # ISO8601 UTC
    systolic: int | None       # 最高血圧 (mmHg)
    diastolic: int | None      # 最低血圧 (mmHg)
    pulse: int | None          # 脈拍 (bpm)
    model: str
    synced_at: str
```

### 6.3 認証型

```python
class OAuth2Credentials(TypedDict):
    """OAuth 2.0認証情報"""
    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    scope: str

class TokenResponse(TypedDict):
    """トークンレスポンス"""
    access_token: str
    refresh_token: str
    expires_in: int  # 秒（3時間 = 10800）
    token_type: str

class SyncResult(TypedDict):
    """同期結果"""
    success: bool
    records: int
    error: str | None
```

## 7. API仕様

### 7.1 エンドポイント

| データ型 | エンドポイント | パラメータ | レスポンス |
|---------|-------------|-----------|-----------|
| 体組成 | `GET /status/innerscan.json` | access_token, date, from, to, tag | `{"status": "0", "data": [...]}` |
| 血圧 | `GET /status/sphygmomanometer.json` | access_token, date, from, to, tag | `{"status": "0", "data": [...]}` |

### 7.2 リクエストパラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| access_token | アクセストークン | - |
| date | 取得方法（0=最新、1=期間指定） | "1" |
| from | 開始日時（yyyyMMddHHmmss） | "20251101000000" |
| to | 終了日時（yyyyMMddHHmmss） | "20251201000000" |
| tag | 測定項目タグ（カンマ区切り） | "6021,6022" |

### 7.3 認証

**OAuth 2.0 Authorization Code Flow**

1. 初回認証（手動、ブラウザ経由）
   - Authorization URL: `https://www.healthplanet.jp/oauth/auth`
   - Token URL: `https://www.healthplanet.jp/oauth/token`

2. トークンリフレッシュ（自動）
   ```
   POST https://www.healthplanet.jp/oauth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=refresh_token
   &refresh_token={refresh_token}
   &client_id={client_id}
   &client_secret={client_secret}
   ```

### 7.4 レスポンス構造

**体組成データ**:
```json
{
  "status": "0",
  "data": [
    {
      "date": "202511301530",
      "keydata": "70.5",
      "model": "01000117",
      "tag": "6021"
    },
    {
      "date": "202511301530",
      "keydata": "18.5",
      "model": "01000117",
      "tag": "6022"
    }
  ]
}
```

**血圧データ**:
```json
{
  "status": "0",
  "data": [
    {
      "date": "202511301530",
      "keydata": "120",
      "model": "01000078",
      "tag": "622E"
    },
    {
      "date": "202511301530",
      "keydata": "80",
      "model": "01000078",
      "tag": "622F"
    },
    {
      "date": "202511301530",
      "keydata": "72",
      "model": "01000078",
      "tag": "6230"
    }
  ]
}
```

### 7.5 測定タグ一覧

**体組成 (innerscan)**:

| タグ | 項目 | 単位 | 状態 |
|------|------|------|------|
| 6021 | 体重 | kg | 有効 |
| 6022 | 体脂肪率 | % | 有効 |
| 6023 | 筋肉量 | kg | 廃止 (2020/6/29) |
| 6024 | 筋肉スコア | - | 廃止 |
| 6025 | 内臓脂肪レベル2 | - | 廃止 |
| 6026 | 内臓脂肪レベル | - | 廃止 |
| 6027 | 基礎代謝量 | kcal | 廃止 |
| 6028 | 体内年齢 | 歳 | 廃止 |
| 6029 | 推定骨量 | kg | 廃止 |

**血圧 (sphygmomanometer)**:

| タグ | 項目 | 単位 | 状態 |
|------|------|------|------|
| 622E | 最高血圧 | mmHg | 有効 |
| 622F | 最低血圧 | mmHg | 有効 |
| 6230 | 脈拍 | bpm | 有効 |

## 8. データベース設計

### 8.1 テーブル一覧

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `raw.tanita_body_composition` | `measured_at` | 体組成データ |
| `raw.tanita_blood_pressure` | `measured_at` | 血圧データ |

### 8.2 テーブル定義

**raw.tanita_body_composition**:
```sql
CREATE TABLE raw.tanita_body_composition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measured_at TIMESTAMPTZ NOT NULL UNIQUE,
    weight NUMERIC,
    body_fat_percent NUMERIC,
    model TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);
```

**raw.tanita_blood_pressure**:
```sql
CREATE TABLE raw.tanita_blood_pressure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    measured_at TIMESTAMPTZ NOT NULL UNIQUE,
    systolic INTEGER,
    diastolic INTEGER,
    pulse INTEGER,
    model TEXT,
    synced_at TIMESTAMPTZ DEFAULT now()
);
```

### 8.3 upsert仕様

```python
# Supabase Python Client
table.upsert(
    data,
    on_conflict="measured_at"
).execute()
```

**動作**:
- 主キー（measured_at）重複時: 全カラム更新
- 新規レコード: INSERT

## 9. エラーハンドリング

### 9.1 エラー分類

| エラータイプ | 検出方法 | 対処 |
|------------|---------|------|
| 認証エラー | status != "0" | トークンリフレッシュ |
| APIエラー | status != "0" | ログ記録、空リスト返却 |
| 文字エンコードエラー | UnicodeDecodeError | Shift_JISで再試行 |
| ネットワークエラー | httpx.HTTPStatusError | ログ記録、raise |
| DB エラー | response.error | ログ記録、raise |

### 9.2 エラーレスポンス

**APIエラー**:
```json
{
  "status": "1",
  "error": "Authentication failed"
}
```

**正常レスポンス（データなし）**:
```json
{
  "status": "0",
  "data": []
}
```

## 10. パフォーマンス

### 10.1 ベンチマーク（30日分同期）

| フェーズ | 処理時間 | リクエスト数 |
|---------|---------|------------|
| 認証（キャッシュヒット） | <1秒 | 0 |
| 認証（リフレッシュ） | ~2秒 | 1 |
| 体組成データ取得 | ~1秒 | 1 |
| 血圧データ取得 | ~1秒 | 1 |
| データ変換 | <1秒 | 0 |
| DB保存 | ~1秒 | 2 |
| **合計** | **~6秒** | **4** |

### 10.2 実績データ

```
[2025-12-01 15:46:49] Starting Tanita sync (30 days)
[2025-12-01 15:46:51] Token valid (26304 min remaining)
[2025-12-01 15:46:51] Fetched 60 body composition measurements
[2025-12-01 15:46:52] Fetched 87 blood pressure measurements
[2025-12-01 15:46:52] Converted to 30 body composition, 29 blood pressure records
[2025-12-01 15:46:53] Sync completed: 30 body composition, 29 blood pressure records
{'success': True, 'records': 59, 'error': None}
```

### 10.3 スケーラビリティ

| 日数 | 期間数 | リクエスト数 | 処理時間（概算） |
|------|--------|-------------|----------------|
| 3日 | 1 | 2 | ~3秒 |
| 30日 | 1 | 2 | ~4秒 |
| 90日 | 1 | 2 | ~5秒 |
| 180日 | 2 | 4 | ~8秒 |
| 365日 | 5 | 10 | ~15秒 |

## 11. テスト戦略

### 11.1 テスト構成

| テストタイプ | ファイル | 件数 | カバレッジ |
|------------|---------|------|-----------|
| Unit Tests | `tests/pipelines/test_tanita.py` | 18 | Helper, Transform, DB |
| Integration Tests | 同上 | 6 | API Fetch, Full Sync |
| **合計** | - | **24** | **~98%** |

### 11.2 主要テストケース

**Helper Functions (6件)**:
- `test_format_tanita_date`: 日付フォーマット変換（14桁）
- `test_parse_tanita_date`: 日付パース・UTC変換（12桁）
- `test_parse_tanita_date_14_digits`: 日付パース・UTC変換（14桁）
- `test_parse_tanita_date_invalid`: 日付パース異常値
- `test_generate_periods_single_chunk`: 期間分割（1チャンク）
- `test_generate_periods_multiple_chunks`: 期間分割（複数チャンク）

**Authentication (4件)**:
- `test_get_access_token_cached`: キャッシュヒット
- `test_get_access_token_refresh_needed`: リフレッシュ必要
- `test_refresh_token_from_api_success`: API成功
- `test_refresh_token_from_api_error`: APIエラー

**Data Transformation (4件)**:
- `test_to_db_body_composition`: 体組成変換
- `test_to_db_body_composition_multiple_timestamps`: 複数タイムスタンプ
- `test_to_db_blood_pressure`: 血圧変換
- `test_to_db_blood_pressure_multiple_timestamps`: 複数タイムスタンプ

**DB Operations (4件)**:
- `test_upsert_body_composition_empty`: 空リスト
- `test_upsert_body_composition_success`: 体組成upsert
- `test_upsert_blood_pressure_empty`: 空リスト
- `test_upsert_blood_pressure_success`: 血圧upsert

**Integration Tests (4件)**:
- `test_fetch_body_composition_success`: 体組成API取得
- `test_fetch_body_composition_api_error`: 体組成APIエラー
- `test_fetch_blood_pressure_success`: 血圧API取得
- `test_fetch_blood_pressure_api_error`: 血圧APIエラー

**Full Sync (2件)**:
- `test_sync_tanita_success`: 全データ型統合同期
- `test_sync_tanita_failure`: 認証失敗

### 11.3 テスト実行

```bash
# 全テスト実行
pytest tests/pipelines/test_tanita.py -v

# 特定テストのみ
pytest tests/pipelines/test_tanita.py::test_parse_tanita_date -v

# カバレッジ測定
pytest tests/pipelines/test_tanita.py --cov=pipelines.services.tanita
```

### 11.4 テストカバレッジ対応表

| 関数/クラス | テスト | カバレッジ |
|------------|--------|-----------|
| `format_tanita_date` | `test_format_tanita_date` | 100% |
| `parse_tanita_date` | `test_parse_tanita_date`, `test_parse_tanita_date_14_digits`, `test_parse_tanita_date_invalid` | 100% |
| `generate_periods` | `test_generate_periods_*` (2件) | 100% |
| `get_access_token` | `test_get_access_token_*` (2件) | 100% |
| `refresh_token_from_api` | `test_refresh_token_from_api_*` (2件) | 100% |
| `_parse_api_response` | 間接テスト（fetch_*経由） | 部分（Shift_JIS未テスト） |
| `_extract_measurements` | 間接テスト（fetch_*経由） | 100% |
| `fetch_body_composition` | `test_fetch_body_composition_*` (2件) | 100% |
| `fetch_blood_pressure` | `test_fetch_blood_pressure_*` (2件) | 100% |
| `to_db_body_composition` | `test_to_db_body_composition_*` (2件) | 100% |
| `to_db_blood_pressure` | `test_to_db_blood_pressure_*` (2件) | 100% |
| `upsert_body_composition` | `test_upsert_body_composition_*` (2件) | 100% |
| `upsert_blood_pressure` | `test_upsert_blood_pressure_*` (2件) | 100% |
| `sync_tanita` | `test_sync_tanita_*` (2件) | 100% |

**未テストの機能**:
- `_parse_api_response`: Shift_JISエンコーディングのレスポンス処理（実環境でのみ発生）
- `main`: CLIエントリーポイント（統合テストで間接的にカバー）

## 12. 運用

### 12.1 実行方法

**手動実行**:
```bash
python -c "import asyncio; from pipelines.services.tanita import sync_tanita; print(asyncio.run(sync_tanita(days=30)))"
```

**CLIモジュール実行**:
```bash
python -m pipelines.services.tanita
```

**GitHub Actions（予定）**:
```yaml
# .github/workflows/sync-daily.yml
- name: Sync Tanita
  run: python -m pipelines.services.tanita
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    ENCRYPTION_KEY: ${{ secrets.ENCRYPTION_KEY }}
```

### 12.2 ログ出力

```
[2025-12-01 15:46:49] INFO [tanita] Starting Tanita sync (30 days)
[2025-12-01 15:46:51] INFO [tanita] Token valid (26304 min remaining)
[2025-12-01 15:46:51] INFO [tanita] Fetching 1 period(s)
[2025-12-01 15:46:51] INFO [tanita] Fetched 60 body composition measurements (2025-11-01 to 2025-12-02)
[2025-12-01 15:46:52] INFO [tanita] Fetched 87 blood pressure measurements (2025-11-01 to 2025-12-02)
[2025-12-01 15:46:52] INFO [tanita] Total: 60 body composition, 87 blood pressure
[2025-12-01 15:46:52] INFO [tanita] Converted to 30 body composition, 29 blood pressure records
[2025-12-01 15:46:52] INFO [tanita] Saving body composition... (30 records)
[2025-12-01 15:46:52] INFO [tanita] Saved 30 body composition records
[2025-12-01 15:46:52] INFO [tanita] Saving blood pressure... (29 records)
[2025-12-01 15:46:53] INFO [tanita] Saved 29 blood pressure records
[2025-12-01 15:46:53] INFO [tanita] Sync completed: 30 body composition, 29 blood pressure records
```

### 12.3 モニタリング

**監視項目**:
- 同期成功/失敗回数
- データ件数（体組成、血圧それぞれ）
- トークンリフレッシュ頻度
- 処理時間

**アラート条件**:
- 3日連続同期失敗
- トークンリフレッシュ失敗

## 13. 将来対応

### 13.1 短期（1-2ヶ月）

- [ ] GitHub Actions統合
- [ ] 歩数データ追加（/status/pedometer.json）
- [ ] Shift_JISエンコーディングの直接テスト追加

### 13.2 中期（3-6ヶ月）

- [ ] レート制限管理（明示的なThrottler実装）
- [ ] リトライ機構追加
- [ ] 差分同期実装（前回同期以降のデータのみ取得）

### 13.3 長期（6ヶ月以降）

- [ ] 他のHealth Planet対応機器データ統合
- [ ] データ可視化ダッシュボード連携

## 14. 参考資料

### 14.1 外部ドキュメント

- [Health Planet API仕様書](https://www.healthplanet.jp/apis/api.html)
- [OAuth 2.0認証フロー](https://www.healthplanet.jp/apis/oauth.html)

### 14.2 内部ドキュメント

- `docs/DESIGN.md` - 全体設計書
- `supabase/migrations/20251124130000_migrate_to_raw_schema.sql` - DBスキーマ
- `tests/pipelines/test_tanita.py` - テストコード（約550行）

## 15. 変更履歴

| バージョン | 日付 | 変更内容 |
|----------|------|---------|
| 1.0.0 | 2025-12-01 | 初版作成（体組成+血圧実装完了・テスト済み） |
| 1.1.0 | 2025-12-01 | ADRフォーマット統一、テスト件数更新（24件） |

---

**ドキュメント終了**
