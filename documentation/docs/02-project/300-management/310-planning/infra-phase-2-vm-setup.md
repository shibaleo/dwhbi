---
title: "Phase 2: VM 環境構築"
description: Docker、開発ツール、VSCode Remote SSH環境を構築
---

# Phase 2: VM 環境構築

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | Docker、開発ツールのインストール、VSCode Remote SSH設定 |
| 前提条件 | Phase 1 完了（SSH接続確立済み） |
| 成果物 | Docker稼働、VSCode Remote SSH接続可能 |
| 想定作業 | VM上でのコマンド実行、ローカルVSCode設定 |

---

## Step 2.1: システム更新

**目的:** OSパッケージを最新化

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.1.1 | SSH接続 | `ssh lifetracer` | ⬜ |
| 2.1.2 | パッケージリスト更新 | `sudo apt update` | ⬜ |
| 2.1.3 | パッケージアップグレード | `sudo apt upgrade -y` | ⬜ |
| 2.1.4 | 自動更新設定 | `sudo apt install unattended-upgrades -y` | ⬜ |
| 2.1.5 | 再起動（必要な場合） | `sudo reboot` | ⬜ |

### 確認

```bash
# カーネルバージョン確認
uname -r

# 保留中の更新確認
apt list --upgradable
```

---

## Step 2.2: 基本ツールインストール

**目的:** 開発・運用に必要な基本ツールをインストール

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.2.1 | 基本ツール | `sudo apt install -y git curl wget vim htop jq` | ⬜ |
| 2.2.2 | ビルドツール | `sudo apt install -y build-essential` | ⬜ |
| 2.2.3 | ネットワークツール | `sudo apt install -y net-tools dnsutils` | ⬜ |

### インストールされるパッケージ

| パッケージ | 用途 |
|-----------|------|
| git | バージョン管理 |
| curl, wget | HTTPクライアント |
| vim | テキストエディタ |
| htop | プロセスモニタ |
| jq | JSON処理 |
| build-essential | ビルドツール (gcc, make等) |
| net-tools | ifconfig等 |
| dnsutils | dig, nslookup等 |

---

## Step 2.3: タイムゾーン確認

**目的:** タイムゾーンが UTC であることを確認（cron との整合性のため UTC を維持）

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.3.1 | 現在のタイムゾーン確認 | `timedatectl` | ⬜ |
| 2.3.2 | UTC であることを確認 | デフォルトで UTC | ⬜ |

### 確認

```bash
$ timedatectl
               Local time: Mon 2025-XX-XX 03:00:00 UTC
           Universal time: Mon 2025-XX-XX 03:00:00 UTC
                 RTC time: Mon 2025-XX-XX 03:00:00
                Time zone: Etc/UTC (UTC, +0000)
```

> **Note:** crontab は UTC 時刻で記述するため、VM のタイムゾーンも UTC に統一する。JST への変換は `TZ=Asia/Tokyo date` で確認可能。

---

## Step 2.4: Docker インストール

**目的:** Docker Engine と Docker Compose v2 をインストール

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.4.1 | 古いバージョン削除 | (下記参照) | ⬜ |
| 2.4.2 | リポジトリ設定 | (下記参照) | ⬜ |
| 2.4.3 | Docker インストール | (下記参照) | ⬜ |
| 2.4.4 | ユーザーをdockerグループに追加 | `sudo usermod -aG docker $USER` | ⬜ |
| 2.4.5 | 再ログイン | `exit` → 再接続 | ⬜ |
| 2.4.6 | 動作確認 | `docker run hello-world` | ⬜ |

### インストールスクリプト

```bash
# 古いバージョン削除
for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do
  sudo apt-get remove -y $pkg 2>/dev/null || true
done

# Docker公式GPGキー追加
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# リポジトリ追加
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker インストール
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# ユーザーをdockerグループに追加
sudo usermod -aG docker $USER
```

### 確認

```bash
# 再ログイン後

$ docker --version
Docker version 27.x.x, build xxxxxxx

$ docker compose version
Docker Compose version v2.x.x

$ docker run hello-world
Hello from Docker!
...
```

---

## Step 2.5: Docker 自動起動設定

**目的:** システム起動時にDockerが自動起動するよう設定

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.5.1 | 自動起動有効化 | `sudo systemctl enable docker` | ⬜ |
| 2.5.2 | containerd自動起動 | `sudo systemctl enable containerd` | ⬜ |
| 2.5.3 | サービス状態確認 | `sudo systemctl status docker` | ⬜ |

### 確認

```bash
$ sudo systemctl is-enabled docker
enabled

$ sudo systemctl status docker
● docker.service - Docker Application Container Engine
     Loaded: loaded (/usr/lib/systemd/system/docker.service; enabled; vendor preset: disabled)
     Active: active (running)
```

---

## Step 2.6: 作業ディレクトリ作成

**目的:** アプリケーション配置用ディレクトリを作成

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.6.1 | ディレクトリ作成 | `sudo mkdir -p /opt/supabase-sync-jobs` | ⬜ |
| 2.6.2 | 所有者変更 | `sudo chown -R ubuntu:ubuntu /opt/supabase-sync-jobs` | ⬜ |
| 2.6.3 | ログディレクトリ作成 | `sudo mkdir -p /var/log/supabase-sync-jobs` | ⬜ |
| 2.6.4 | ログ所有者変更 | `sudo chown -R ubuntu:ubuntu /var/log/supabase-sync-jobs` | ⬜ |

### ディレクトリ構造

```
/opt/supabase-sync-jobs/     # アプリケーションルート
  └── infra/                 # docker-compose.yml等

/var/log/supabase-sync-jobs/ # ログ出力先
  ├── sync.log
  ├── dbt.log
  └── reporter.log
```

---

## Step 2.7: Git 設定

**目的:** リポジトリクローン用のGit設定

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.7.1 | Git設定（名前） | `git config --global user.name "Your Name"` | ⬜ |
| 2.7.2 | Git設定（メール） | `git config --global user.email "you@example.com"` | ⬜ |
| 2.7.3 | デフォルトブランチ | `git config --global init.defaultBranch main` | ⬜ |

> **Note:** GitHub Actionsでのデプロイを使用する場合、VM上でのGit認証設定は不要

---

## Step 2.8: VSCode Remote SSH 設定

**目的:** ローカルVSCodeからVMに接続して開発

### タスク（ローカルマシン）

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 2.8.1 | Remote - SSH 拡張インストール | VSCode Extensions で "Remote - SSH" 検索・インストール | ⬜ |
| 2.8.2 | コマンドパレット開く | `Ctrl+Shift+P` / `Cmd+Shift+P` | ⬜ |
| 2.8.3 | Remote接続 | "Remote-SSH: Connect to Host..." → lifetracer | ⬜ |
| 2.8.4 | プラットフォーム選択 | Linux | ⬜ |
| 2.8.5 | 接続確認 | 左下に "SSH: lifetracer" と表示 | ⬜ |

### タスク（VM側拡張インストール）

Remote接続後、VM側にインストールする拡張:

| # | 拡張機能 | 用途 | 状態 |
|---|---------|------|------|
| 2.8.6 | Docker | Dockerファイル編集、コンテナ管理 | ⬜ |
| 2.8.7 | YAML | docker-compose.yml等 | ⬜ |
| 2.8.8 | GitLens | Git履歴表示 | ⬜ |

### 確認

```
VSCode ウィンドウ左下:
┌─────────────────────┐
│ >< SSH: lifetracer  │
└─────────────────────┘
```

---

## Step 2.9: システム監視設定

**目的:** リソース使用状況の簡易監視設定

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 2.9.1 | ディスク使用量確認スクリプト | 下記参照 | ⬜ |
| 2.9.2 | htop でプロセス確認 | `htop` | ⬜ |

### 簡易ディスク監視 (オプション)

```bash
# /opt/supabase-sync-jobs/scripts/check-disk.sh
#!/bin/bash
THRESHOLD=80
USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$USAGE" -gt "$THRESHOLD" ]; then
  echo "Warning: Disk usage is ${USAGE}%"
fi
```

---

## 完了チェックリスト

- [ ] システムパッケージが最新化された
- [ ] 基本ツール (git, curl, vim, htop, jq) がインストールされた
- [ ] タイムゾーンが Asia/Tokyo に設定された
- [ ] `docker --version` が表示される
- [ ] `docker compose version` が表示される
- [ ] `docker run hello-world` が成功
- [ ] Docker が systemd で自動起動設定済み
- [ ] `/opt/supabase-sync-jobs` ディレクトリが作成された
- [ ] `/var/log/supabase-sync-jobs` ディレクトリが作成された
- [ ] VSCode Remote SSH で lifetracer に接続可能
- [ ] VM側にDocker拡張がインストールされた

---

## トラブルシューティング

### Docker権限エラー

```bash
# エラー: permission denied while trying to connect to the Docker daemon socket
# 解決: グループ追加後、再ログインが必要
exit
ssh lifetracer
```

### VSCode Remote SSH 接続失敗

```bash
# ~/.ssh/config の IdentityFile パスを確認
# 秘密鍵のパーミッションを確認 (600)
# VM側の SSH サービス状態確認
sudo systemctl status ssh
```

---

## 次のステップ

→ [Phase 3: infraディレクトリ作成](./infra-phase-3-infra-directory)
