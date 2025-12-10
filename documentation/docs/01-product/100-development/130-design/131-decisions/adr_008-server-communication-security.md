---
title: ADR-008 サーバー間通信セキュリティ設計
description: Vercel と OCI VM 間の通信におけるセキュリティ設計の決定
status: 承認済み
date: 2024-12-10
---

# ADR-008: サーバー間通信セキュリティ設計

## ステータス

承認済み

## コンテキスト

本システムでは、Vercel にホストされた console（Next.js）から OCI VM 上の server（Hono）へ API リクエストを送信する。この通信のセキュリティ設計を決定する必要がある。

### システム構成

```
ユーザー ──HTTPS──→ Vercel (console)
                        │
                        ▼ HTTP（検討対象）
                   OCI VM:3000 (server)
                        │
                        ▼
                   Supabase
```

### 要件

- ポートフォリオとして公開するため、セキュリティ意識の高さを示したい
- 個人開発のため、コストは最小限に抑えたい
- 設計判断の理由を明確に説明できること

## 検討した選択肢

### 選択肢 A: HTTPS（Cloudflare Tunnel + 独自ドメイン）

```
Vercel ──HTTPS──→ Cloudflare ──Tunnel──→ OCI VM
```

| 項目 | 評価 |
|------|------|
| セキュリティ | ✅ TLS 暗号化、証明書自動管理 |
| コスト | 年1,200円〜（ドメイン代） |
| 設定難易度 | 中（Tunnel 設定、DNS 設定） |
| ポート開放 | 不要（Tunnel 経由） |

**メリット:**
- 業界標準の暗号化
- ポート開放不要でセキュア
- DDoS 保護（Cloudflare）

**デメリット:**
- ドメイン費用が発生
- 設定がやや複雑

### 選択肢 B: HTTPS（Let's Encrypt + OCI Load Balancer）

```
Vercel ──HTTPS──→ OCI LB ──→ OCI VM
```

| 項目 | 評価 |
|------|------|
| セキュリティ | ✅ TLS 暗号化 |
| コスト | 無料枠内（ただし制限あり） |
| 設定難易度 | 高（証明書更新の自動化必要） |
| ポート開放 | 443 のみ |

**メリット:**
- OCI 内で完結
- 無料枠で対応可能

**デメリット:**
- 証明書更新の運用負荷
- ドメインは必要

### 選択肢 C: HTTP + IP 制限（採用）

```
Vercel ──HTTP──→ OCI VM:3000
                    ↑
           Security List で IP 制限
```

| 項目 | 評価 |
|------|------|
| セキュリティ | ○ IP 制限で不正アクセス防止 |
| コスト | 無料 |
| 設定難易度 | 低 |
| ポート開放 | 3000（Vercel IP のみ） |

**メリット:**
- ドメイン不要、追加コストなし
- 設定がシンプル
- Vercel 以外からのアクセスを完全ブロック

**デメリット:**
- 通信が暗号化されない（盗聴リスク）

### 選択肢 D: 自前暗号化

```
Vercel ──HTTP + 自前暗号化──→ OCI VM
```

| 項目 | 評価 |
|------|------|
| セキュリティ | △〜❌ 実装ミスのリスク |
| コスト | 無料 |
| 設定難易度 | 高 |

**却下理由:**
- TLS の再発明になる
- 鍵管理、中間者攻撃対策、リプレイ攻撃対策を自前実装する必要
- セキュリティホールの温床になりやすい
- 「なぜ自前暗号化？」と質問された際の説明が困難

## 決定

**選択肢 C: HTTP + IP 制限** を採用する。

### 理由

1. **コスト効率**: 個人開発でドメイン費用を抑えられる

2. **十分なセキュリティ**:
   - OCI Security List で Vercel の IP レンジのみ許可
   - 不正アクセス、ブルートフォース、ポートスキャンを防止
   - IP 偽装は ISP レベルで困難

3. **通信内容の機密性が低い**:
   - 「Toggl を同期して」程度のコマンド
   - 認証トークンは含まない（IP 制限で認証代替）
   - 盗聴されても攻撃者は IP 制限で弾かれる

4. **トレードオフの明示**:
   - 本 ADR でセキュリティ検討プロセスを文書化
   - 判断理由を説明可能

### 残存リスクと対策

| リスク | 発生確率 | 影響 | 対策 |
|--------|:--------:|:----:|------|
| 通信傍受 | 低 | 低（機密情報なし） | 許容 |
| Vercel IP 偽装 | 極低 | 中 | 許容（技術的に困難） |
| Vercel 侵害 | 極低 | 高 | 許容（Vercel のセキュリティに依存） |

### 将来の拡張

本番環境やセキュリティ要件が高まった場合は、選択肢 A（Cloudflare Tunnel）への移行を検討する。移行は以下の手順で可能:

1. ドメイン取得
2. Cloudflare Tunnel 設定
3. OCI VM のポート閉鎖
4. Vercel の環境変数を HTTPS URL に変更

## 実装

### OCI Security List 設定

```
Ingress Rules:
  - Source: 76.76.21.0/24 (Vercel)
  - Protocol: TCP
  - Destination Port: 3000
  - Description: Vercel serverless functions
```

Vercel の IP レンジは [公式ドキュメント](https://vercel.com/docs/security/deployment-protection) を参照。

### server 実装

```typescript
// 認証ミドルウェア不要（IP 制限で代替）
app.post('/api/sync/:service', async (c) => {
  const service = c.req.param('service')
  // ...
})
```

### 監視

- OCI Security List のログで不正アクセス試行を監視
- 想定外の IP からのアクセスがあればアラート

## 結論

個人開発プロジェクトにおいて、コストとセキュリティのバランスを考慮し、HTTP + IP 制限を採用する。この決定は以下の前提に基づく:

- 通信内容の機密性が低い
- IP 制限により不正アクセスを防止できる
- 設計判断のプロセスを文書化している

セキュリティ要件の変化に応じて、Cloudflare Tunnel への移行パスを確保している。

## 関連ドキュメント

- [ADR-007 インフラストラクチャ配置](/01-product/100-development/130-design/131-decisions/adr_007-infrastructure-layout)
- [インフラ構築計画](/02-project/300-management/310-planning/infrastructure-plan)
