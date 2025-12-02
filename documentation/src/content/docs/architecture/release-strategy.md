---
title: リリース戦略
description: サービス追加とバージョニングの方針
---

## 概要

LIFETRACERは段階的にサービスを追加していきます。API Token系のシンプルなサービスから始め、OAuth系の複雑なサービスへと進みます。

---

## バージョニング

### セマンティックバージョニング

```
MAJOR.MINOR.PATCH

MAJOR: 破壊的変更（スキーマ変更等）
MINOR: サービス追加
PATCH: バグ修正、ドキュメント更新
```

### リリース計画

#### Phase 0: API Token系（シンプル）

| バージョン | サービス | 認証方式 | 備考 |
|-----------|---------|---------|------|
| v0.1.0 | Toggl Track | API Token | 時間管理 |
| v0.2.0 | Trello | API Key + Token | プロジェクト管理 |
| v0.3.0 | Airtable | PAT | マスタ管理 |

#### Phase 1: OAuth系

| バージョン | サービス | 認証方式 | 備考 |
|-----------|---------|---------|------|
| v0.4.0 | Fitbit | OAuth 2.0 | 健康管理 |
| v0.5.0 | Tanita | OAuth 2.0 | 健康管理 |
| v0.6.0 | Google Calendar | OAuth 2.0 | 予定管理 |
| v0.7.0 | TickTick | OAuth 2.0 | タスク/習慣管理 |
| v0.8.0 | Zaim | OAuth 1.0a | 家計管理 |

#### v1.0.0: 正式リリース

- 全8サービス対応完了
- 管理ダッシュボード安定
- ドキュメント完備

---

## サービス追加の成果物

### 1サービスに必要な成果物

| カテゴリ | 成果物 | 必須/推奨 |
|---------|--------|:--------:|
| **スキーマ** | マイグレーションSQL | 必須 |
| | rawテーブル定義 | 必須 |
| **パイプライン** | 認証処理（auth.py） | 必須 |
| | API取得（api.py） | 必須 |
| | DB書き込み（write_db.py） | 必須 |
| | 同期スクリプト（sync.py） | 必須 |
| **管理UI** | 設定フォーム | 必須 |
| | Vault保存ロジック | 必須 |
| **GitHub Actions** | ワークフロー統合 | 必須 |
| **テスト** | ユニットテスト | 推奨 |
| **ドキュメント** | スキーマ定義書更新 | 必須 |
| | サービス固有README | 推奨 |

---

## サービス追加チェックリスト

```markdown
## v0.X.0 サービス追加チェックリスト

### 必須
- [ ] rawテーブルスキーマ定義（構造化列 + raw_response）
- [ ] マイグレーションSQL
- [ ] 認証処理実装
- [ ] API取得実装
- [ ] DB書き込み実装
- [ ] 同期スクリプト実装
- [ ] 管理UI設定フォーム
- [ ] Vault保存/読み取り
- [ ] GitHub Actions統合
- [ ] dwh-layers.md 更新（テーブル一覧）
- [ ] security.md 更新（認証方式一覧）

### 推奨
- [ ] ユニットテスト
- [ ] サービス固有README
- [ ] トークンリフレッシュ対応（OAuth系）

### リリース前確認
- [ ] 手動テスト完了
- [ ] ドキュメント整合性確認
- [ ] CHANGELOGに記載
```

---

## v0.1.0 スコープ（Toggl Track）

### 含まれる機能

| カテゴリ | 内容 |
|---------|------|
| **管理UI** | 基本フレームワーク + Toggl設定フォーム |
| **認証** | メール + パスワード |
| **マイグレーション** | 自動実行 + Togglスキーマ |
| **パイプライン** | Toggl同期 |
| **GitHub連携** | オプション（PAT入力） |

### rawテーブル

```sql
-- toggl.clients
-- toggl.projects
-- toggl.tags
-- toggl.entries
```

### 設定フォーム

```
┌─────────────────────────────────────────────────────────────┐
│  Toggl 設定                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚠️ 1ワークスペースのみ対応しています                         │
│                                                             │
│  API Token                                                  │
│  [____________________________________]                     │
│                                                             │
│  Workspace ID                                               │
│  [____________________________________]                     │
│                                                             │
│  [保存]  [連携解除]                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## rawテーブルスキーマテンプレート

新規サービス追加時は以下のテンプレートを使用：

```sql
-- {service}.{entity}
CREATE TABLE {service}.{entity} (
  -- 識別子
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  {service}_id BIGINT UNIQUE NOT NULL,  -- サービス側のID
  
  -- 構造化列（頻繁にクエリする項目）
  -- TODO: サービス固有の重要項目を追加
  
  -- 生データ保存（API変更への耐性）
  raw_response JSONB NOT NULL,
  
  -- メタデータ
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス（必要に応じて）
CREATE INDEX idx_{service}_{entity}_date ON {service}.{entity}(date);
```

---

## 認証方式テンプレート

### API Token系

```python
# auth.py
def get_credentials():
    """Vaultから認証情報を取得"""
    return vault.get_secret("{service}")

def validate_credentials(credentials):
    """認証情報の有効性を確認"""
    # APIエンドポイントに問い合わせ
    pass
```

### OAuth 2.0系

```python
# auth.py
def get_credentials():
    """Vaultから認証情報を取得"""
    return vault.get_secret("{service}")

def refresh_token_if_needed(credentials):
    """必要に応じてトークンをリフレッシュ"""
    if is_token_expiring(credentials):
        new_tokens = refresh_oauth_token(credentials)
        vault.update_secret("{service}", new_tokens)
        return new_tokens
    return credentials
```

---

## 関連ドキュメント

- [管理ダッシュボード設計](admin-dashboard)
- [認証・セキュリティ設計](security)
- [DWH 4層アーキテクチャ](dwh-layers)

---

*最終更新: 2025-12-02*
