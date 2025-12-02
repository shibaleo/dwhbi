---
title: 認証・セキュリティ設計
---


## 認証情報の保存

```
credentials.services テーブル
├── service: サービス名
├── credentials_encrypted: AES-256-GCM 暗号化済み認証情報
├── nonce: 12バイトのランダム値
└── expires_at: トークン有効期限（OAuth 2.0の場合）
```

## 暗号化方式

| 項目 | 値 |
|------|---|
| アルゴリズム | AES-256-GCM |
| 鍵長 | 256bit (32bytes) |
| Nonce | 12bytes (96bit) |
| 鍵の保存場所 | 環境変数 `TOKEN_ENCRYPTION_KEY` |

## 認証方式一覧

| サービス | 認証方式 | 保存する認証情報 |
|---------|---------|----------------|
| Toggl | Basic Auth | api_token, workspace_id |
| Google Calendar | OAuth 2.0 | client_id/secret, access/refresh_token, calendar_id |
| Zaim | OAuth 1.0a | consumer_key/secret, access_token/secret |
| Fitbit | OAuth 2.0 | client_id/secret, access/refresh_token |
| Tanita | OAuth 2.0 | client_id/secret, access/refresh_token |
| Trello | API Key + Token | api_key, api_token |
| TickTick | OAuth 2.0 | client_id/secret, access/refresh_token |
| Airtable | Personal Access Token | personal_access_token, base_ids |

## トークンリフレッシュ

| サービス | 有効期限 | 閾値 | 戦略 |
|---------|---------|------|------|
| Fitbit | 8時間 | 60分前 | 自動リフレッシュ |
| Tanita | 3時間 | 30分前 | 自動リフレッシュ |
| TickTick | 6時間 | 30分前 | 自動リフレッシュ |
| Google Calendar | 1時間 | 5分前 | 自動リフレッシュ |
| Toggl | なし | - | 不要 |
| Zaim | なし | - | 不要（OAuth 1.0a） |
| Trello | なし | - | 不要（永続トークン） |
| Airtable | なし | - | 不要（PAT） |

## 環境変数

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TOKEN_ENCRYPTION_KEY=... # 32バイトの暗号化キー（絶対に漏洩させない）
```

## セキュリティ注意事項

1. **TOKEN_ENCRYPTION_KEY**:
   - 紛失すると全認証情報が復号不可能になる
   - バックアップを安全な場所に保管
   - 復旧手順を文書化すること

2. **Service Role Key**:
   - RLSをバイパスできる強力な権限
   - GitHub Secretsに保存
   - ローカル開発でも`.env`をgitignore

3. **OAuth トークン**:
   - refresh_token は長期間有効
   - access_token 漏洩時はrefreshで無効化可能
