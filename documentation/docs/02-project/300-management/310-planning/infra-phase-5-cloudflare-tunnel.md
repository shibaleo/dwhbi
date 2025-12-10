---
title: "Phase 5: Cloudflare Tunnel 設定"
description: HTTPS アクセスの確立
---

# Phase 5: Cloudflare Tunnel 設定

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | Cloudflare Tunnel で server を HTTPS 公開 |
| 前提条件 | Phase 4 完了（server 稼働）、Cloudflare アカウント |
| 成果物 | HTTPS でアクセス可能な API エンドポイント |
| 想定作業 | Cloudflare Dashboard 操作、VM設定 |

---

## 前提知識: Cloudflare Tunnel とは

```
┌─────────────────────────────────────────────────────────────┐
│                       Internet                               │
│                          │                                   │
│                          ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Cloudflare Edge Network                     │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │     Tunnel Endpoint (api.example.com)           │  │  │
│  │  │     - SSL終端                                    │  │  │
│  │  │     - DDoS保護                                   │  │  │
│  │  │     - WAF                                        │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│                 Outbound Connection                          │
│                 (cloudflared が確立)                         │
│                          │                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            OCI VM (lifetracer-vm)                      │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │   cloudflared container                         │  │  │
│  │  │   (Tunnel client)                               │  │  │
│  │  │        │                                        │  │  │
│  │  │        ▼                                        │  │  │
│  │  │   server container (Hono)                       │  │  │
│  │  │   http://server:3000                            │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**特徴:**
- Inbound ポート不要（80/443 を閉じても動作）
- cloudflared が Cloudflare への outbound 接続を維持
- 自動 SSL 証明書（Cloudflare 発行）
- DDoS 保護、WAF が自動適用

---

## Step 5.1: Cloudflare アカウント準備

**目的:** Tunnel 作成に必要なアカウント設定を確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.1.1 | Cloudflare アカウント確認 | https://dash.cloudflare.com/ にログイン | ⬜ |
| 5.1.2 | ドメイン確認 | Cloudflare で管理しているドメインを確認 | ⬜ |
| 5.1.3 | Zero Trust 有効化 | Zero Trust Dashboard にアクセス | ⬜ |

### 確認事項

- [ ] Cloudflare でドメインが管理されている（NS が Cloudflare）
- [ ] Zero Trust (旧 Cloudflare for Teams) が有効
- [ ] 支払い情報が設定されている（Free プランでも可）

---

## Step 5.2: Tunnel 作成

**目的:** Cloudflare Dashboard で Tunnel を作成

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.2.1 | Zero Trust Dashboard | https://one.dash.cloudflare.com/ | ⬜ |
| 5.2.2 | Networks → Tunnels | メニューから選択 | ⬜ |
| 5.2.3 | Create a tunnel | ボタンクリック | ⬜ |
| 5.2.4 | Tunnel type | Cloudflared 選択 | ⬜ |
| 5.2.5 | Tunnel name | `lifetracer-tunnel` 入力 | ⬜ |
| 5.2.6 | Save tunnel | 保存 | ⬜ |

### 次の画面でトークン取得

```
Install and run a connector

Choose your environment: Docker

Run the following command:
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TOKEN>

▼ Copy token
eyJhIjoixxxxxxxxxxxxxxxxxx...
```

**重要:** このトークンを安全に保管する

---

## Step 5.3: Public Hostname 設定

**目的:** Tunnel 経由でアクセスするホスト名を設定

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.3.1 | Public Hostnames タブ | Tunnel 詳細画面 | ⬜ |
| 5.3.2 | Add a public hostname | ボタンクリック | ⬜ |
| 5.3.3 | Subdomain 入力 | `api` | ⬜ |
| 5.3.4 | Domain 選択 | `example.com` (所有ドメイン) | ⬜ |
| 5.3.5 | Service Type | HTTP | ⬜ |
| 5.3.6 | Service URL | `server:3000` | ⬜ |
| 5.3.7 | Save hostname | 保存 | ⬜ |

### 設定値

| 項目 | 値 |
|------|-----|
| Subdomain | `api` |
| Domain | `lifetracer.example.com` |
| Path | (空) |
| Type | HTTP |
| URL | `server:3000` |

**結果:** `https://api.lifetracer.example.com` → `http://server:3000` にルーティング

---

## Step 5.4: VM に環境変数設定

**目的:** Tunnel トークンを VM に設定

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.4.1 | SSH で VM 接続 | `ssh lifetracer` | ⬜ |
| 5.4.2 | .env ファイル編集 | トークン追加 | ⬜ |

### .env 設定

```bash
# /opt/supabase-sync-jobs/infra/.env

# ... 他の設定 ...

# Cloudflare Tunnel
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoixxxxxxxxxxxxxxxxxx...
```

### セキュリティ確認

```bash
# パーミッション確認
ls -la /opt/supabase-sync-jobs/infra/.env
# -rw------- 1 ubuntu ubuntu ... .env

# 必要に応じて制限
chmod 600 /opt/supabase-sync-jobs/infra/.env
```

---

## Step 5.5: docker-compose.yml 確認

**目的:** cloudflared サービスが正しく定義されていることを確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.5.1 | docker-compose.yml 確認 | cloudflared サービス定義 | ⬜ |
| 5.5.2 | ネットワーク確認 | server と同じネットワーク | ⬜ |

### docker-compose.yml (cloudflared 部分)

```yaml
services:
  # ... server 定義 ...

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    networks:
      - lifetracer
    restart: unless-stopped
    depends_on:
      - server

networks:
  lifetracer:
    driver: bridge
```

---

## Step 5.6: Tunnel 起動

**目的:** cloudflared コンテナを起動して Tunnel を確立

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 5.6.1 | サービス起動 | `docker compose up -d cloudflared` | ⬜ |
| 5.6.2 | ログ確認 | `docker compose logs -f cloudflared` | ⬜ |
| 5.6.3 | 状態確認 | `docker compose ps` | ⬜ |

### 起動コマンド

```bash
cd /opt/supabase-sync-jobs/infra

# server と cloudflared を起動
docker compose up -d server cloudflared

# ログ確認
docker compose logs -f cloudflared
```

### 正常起動時のログ

```
cloudflared  | 2025-XX-XX INF Starting tunnel tunnelID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
cloudflared  | 2025-XX-XX INF Registered tunnel connection connIndex=0 location=NRT
cloudflared  | 2025-XX-XX INF Registered tunnel connection connIndex=1 location=NRT
cloudflared  | 2025-XX-XX INF Registered tunnel connection connIndex=2 location=NRT
cloudflared  | 2025-XX-XX INF Registered tunnel connection connIndex=3 location=NRT
```

---

## Step 5.7: 接続テスト

**目的:** HTTPS でアクセスできることを確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 5.7.1 | ローカルからテスト | `curl https://api.example.com/health` | ⬜ |
| 5.7.2 | SSL 証明書確認 | ブラウザで確認 | ⬜ |
| 5.7.3 | レイテンシ確認 | `curl -w "@curl-format.txt"` | ⬜ |

### 確認コマンド

```bash
# ヘルスチェック
curl https://api.lifetracer.example.com/health
# {"status":"ok","timestamp":"2025-XX-XXTXX:XX:XX.XXXZ"}

# 詳細情報
curl -v https://api.lifetracer.example.com/health

# SSL証明書確認
echo | openssl s_client -connect api.lifetracer.example.com:443 2>/dev/null | openssl x509 -noout -dates
```

### 期待される結果

- [x] HTTPS でアクセス可能
- [x] SSL 証明書が有効（Cloudflare 発行）
- [x] `/health` が `{"status":"ok"}` を返す

---

## Step 5.8: Cloudflare Dashboard 確認

**目的:** Tunnel 状態を Dashboard で確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.8.1 | Tunnel 状態確認 | Networks → Tunnels → lifetracer-tunnel | ⬜ |
| 5.8.2 | Status: HEALTHY | 緑色で表示 | ⬜ |
| 5.8.3 | Connections 確認 | 4 connections (通常) | ⬜ |

### Dashboard 表示

```
lifetracer-tunnel
Status: ● HEALTHY
Connections: 4
Created: 2025-XX-XX
```

---

## Step 5.9: セキュリティ設定（オプション）

**目的:** アクセス制御を追加

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 5.9.1 | Access Policy 作成 | Zero Trust → Access → Applications | ⬜ |
| 5.9.2 | IP 制限 | 特定 IP のみ許可（オプション） | ⬜ |
| 5.9.3 | Service Token | API アクセス用トークン（オプション） | ⬜ |

### Access Application 設定（オプション）

```
Application name: lifetracer-api
Domain: api.lifetracer.example.com

Policy:
- Allow: Service Token
- Deny: Everyone else
```

> **Note:** console からの呼び出しには Service Token を使用することで、API を保護できる

---

## トラブルシューティング

### Tunnel が接続しない

```bash
# ログ確認
docker compose logs cloudflared

# トークン確認
echo $CLOUDFLARE_TUNNEL_TOKEN | head -c 20

# ネットワーク確認
docker network ls
docker network inspect infra_lifetracer
```

### server に到達しない

```bash
# server が起動しているか確認
docker compose ps server

# 内部ネットワークでの疎通確認
docker compose exec cloudflared wget -qO- http://server:3000/health
```

### SSL エラー

```bash
# DNS 伝播確認
dig api.lifetracer.example.com

# Cloudflare Proxy 状態確認 (Dashboard)
# DNS → api レコード → Proxy status: Proxied (オレンジ雲)
```

---

## 完了チェックリスト

- [ ] Cloudflare Zero Trust で Tunnel が作成された
- [ ] Tunnel 名: `lifetracer-tunnel`
- [ ] Public Hostname が設定された（api.example.com → server:3000）
- [ ] VM の `.env` に `CLOUDFLARE_TUNNEL_TOKEN` が設定された
- [ ] `docker compose up -d cloudflared` が成功
- [ ] Tunnel 状態が HEALTHY
- [ ] `curl https://api.example.com/health` が成功
- [ ] SSL 証明書が有効

---

## 次のステップ

→ [Phase 6: console デプロイ (Vercel)](./infra-phase-6-console-deploy)
