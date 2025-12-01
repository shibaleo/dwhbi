# LIFETRACER Pipelines

データ収集パイプライン（外部API → raw層）

## 構成

```
pipelines/
├── services/          # API同期スクリプト
│   └── toggl.py      # Toggl Track API同期
├── lib/              # 共通ライブラリ
│   ├── credentials.py # 認証情報取得・復号
│   ├── db.py         # Supabase client
│   ├── encryption.py # AES-GCM暗号化
│   └── logger.py     # ロギング
└── main.py           # オーケストレーター（未実装）
```

## セットアップ

```bash
# Python 3.12+ 必須
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 依存関係インストール
pip install -r requirements.txt

# 環境変数設定
cp .env.example .env
# .env を編集して SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY を設定
```

## 使用方法

```python
from pipelines.services.toggl import sync_toggl

# Toggl データを3日分同期
result = await sync_toggl(days=3)
print(f"Synced {result['entries']} entries")
```

## テスト

```bash
# 全テスト実行
pytest

# 特定のテストのみ
pytest tests/pipelines/test_toggl.py

# カバレッジ付き
pytest --cov=pipelines --cov-report=html

# 詳細ログ付き
pytest -v -s
```

## 認証情報の管理

認証情報は `credentials.services` テーブルに暗号化されて保存されます。

```sql
-- credentials.services テーブル構造
CREATE TABLE credentials.services (
    service TEXT PRIMARY KEY,
    auth_type TEXT NOT NULL,
    credentials_encrypted BYTEA NOT NULL,
    expires_at TIMESTAMPTZ
);
```

暗号化キーは環境変数 `TOKEN_ENCRYPTION_KEY` から取得されます（32バイトのBase64エンコード）。

## 新サービスの追加

1. `pipelines/services/{service}.py` を作成
2. 以下の関数を実装:
   - `get_auth_headers()` - 認証ヘッダー取得
   - `fetch_*()` - API呼び出し
   - `to_db_*()` - API型 → DB型変換
   - `upsert_*()` - DB書き込み
   - `sync_{service}()` - メイン同期関数
3. テスト `tests/pipelines/test_{service}.py` を作成

## トラブルシューティング

### `ValueError: TOKEN_ENCRYPTION_KEY environment variable is required`

環境変数 `TOKEN_ENCRYPTION_KEY` が未設定です。`.env` ファイルを確認してください。

### `ValueError: Credentials not found for service: toggl`

`credentials.services` テーブルに Toggl の認証情報が登録されていません。
管理UIまたは手動でデータを投入してください。

### `httpx.HTTPStatusError: 401 Unauthorized`

Toggl API トークンが無効です。`credentials.services` の `api_token` を確認してください。
