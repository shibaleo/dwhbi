---
title: "Phase 1: OCI VM 準備"
description: OCI上に新規VMを作成し、SSH接続を確立する
---

# Phase 1: OCI VM 準備

## 概要

| 項目 | 内容 |
|------|------|
| 目的 | OCI上に新規VMを作成し、SSH接続を確立 |
| 前提条件 | OCIアカウント、ローカルSSHクライアント |
| 成果物 | 稼働中のVM、SSH接続確立 |
| 想定作業 | OCI Console操作、ローカルSSH設定 |

---

## Step 1.1: 既存リソース削除

**目的:** 旧VMおよび関連リソースをクリーンアップ

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 1.1.1 | OCI Console にログイン | https://cloud.oracle.com/ | ⬜ |
| 1.1.2 | superset-vm を Terminate | Compute > Instances > superset-vm > Terminate (Boot Volume も削除) | ⬜ |
| 1.1.3 | superset-nsg を削除 | Networking > Network Security Groups > superset-nsg > Delete | ⬜ |
| 1.1.4 | vcn-20250905-2350 を削除 | Networking > Virtual Cloud Networks > vcn-20250905-2350 > Terminate | ⬜ |
| 1.1.5 | 削除完了を確認 | 各リソースが一覧から消えていることを確認 | ⬜ |

### 注意事項

- VM削除前にデータバックアップが必要な場合は事前に実施
- VCN削除はサブネット、ルートテーブル等の依存リソースも連鎖削除される
- 削除は数分かかる場合がある

---

## Step 1.2: 新規 VCN 作成

**目的:** VM用のネットワーク基盤を構築

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 1.2.1 | VCN作成開始 | Networking > Virtual Cloud Networks > Start VCN Wizard | ⬜ |
| 1.2.2 | "Create VCN with Internet Connectivity" 選択 | 簡易セットアップ | ⬜ |
| 1.2.3 | VCN名入力 | `lifetracer-vcn` | ⬜ |
| 1.2.4 | CIDR設定 | デフォルト `10.0.0.0/16` のまま | ⬜ |
| 1.2.5 | パブリックサブネットCIDR | デフォルト `10.0.0.0/24` のまま | ⬜ |
| 1.2.6 | ウィザード完了 | Create | ⬜ |

### 作成されるリソース

- VCN: `lifetracer-vcn`
- Public Subnet: `public-subnet-lifetracer-vcn`
- Private Subnet: `private-subnet-lifetracer-vcn`
- Internet Gateway: `internet-gateway-lifetracer-vcn`
- NAT Gateway: `nat-gateway-lifetracer-vcn`
- Route Tables / Security Lists: 自動生成

---

## Step 1.3: 新規 VM 作成

**目的:** ARM VMを作成

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 1.3.1 | インスタンス作成開始 | Compute > Instances > Create Instance | ⬜ |
| 1.3.2 | 名前入力 | `lifetracer-vm` | ⬜ |
| 1.3.3 | 配置選択 | Compartment: (root) | ⬜ |
| 1.3.4 | イメージ選択 | Edit > Ubuntu > Canonical Ubuntu 24.04 (aarch64) | ⬜ |
| 1.3.5 | シェイプ選択 | Edit > Ampere > VM.Standard.A1.Flex | ⬜ |
| 1.3.6 | OCPU設定 | 4 OCPU | ⬜ |
| 1.3.7 | メモリ設定 | 24 GB | ⬜ |
| 1.3.8 | VCN選択 | lifetracer-vcn | ⬜ |
| 1.3.9 | サブネット選択 | public-subnet-lifetracer-vcn | ⬜ |
| 1.3.10 | Public IP | Assign a public IPv4 address | ⬜ |
| 1.3.11 | SSHキー生成 | Generate a key pair for me | ⬜ |
| 1.3.12 | 秘密鍵ダウンロード | Save Private Key → `ssh-key-*.key` | ⬜ |
| 1.3.13 | 作成実行 | Create | ⬜ |
| 1.3.14 | 起動完了待機 | State: RUNNING になるまで待機（2-5分） | ⬜ |
| 1.3.15 | Public IP 記録 | Instance Details から Public IP をメモ | ⬜ |

### VM スペック確認

```
Shape:    VM.Standard.A1.Flex
OCPU:     4
Memory:   24 GB
OS:       Ubuntu 24.04 LTS (aarch64)
Storage:  50 GB Boot Volume (default)
```

### 無料枠確認

| リソース | Always Free 制限 | 本構成 |
|---------|-----------------|--------|
| ARM OCPU | 4 OCPU (合計) | 4 OCPU ✓ |
| ARM Memory | 24 GB (合計) | 24 GB ✓ |
| Boot Volume | 200 GB (合計) | 50 GB ✓ |

---

## Step 1.4: Security List 確認

**目的:** SSH ポートが開放されていることを確認

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 1.4.1 | Security List 確認 | Networking > VCN > lifetracer-vcn > Security Lists | ⬜ |
| 1.4.2 | Default Security List 選択 | Default Security List for lifetracer-vcn | ⬜ |
| 1.4.3 | SSH (22) 確認 | デフォルトで 0.0.0.0/0 から許可済み | ⬜ |

### Ingress Rules（最終状態）

| Source | Protocol | Port | 用途 |
|--------|----------|------|------|
| 0.0.0.0/0 | TCP | 22 | SSH |

> **Note:** Cloudflare Tunnel は outbound 接続のみ使用するため、80/443 ポートの開放は不要

---

## Step 1.5: ローカル SSH 設定

**目的:** ローカルマシンからSSH接続を確立

### タスク

| # | タスク | 詳細 | 状態 |
|---|--------|------|------|
| 1.5.1 | 秘密鍵を配置 | ダウンロードした `ssh-key-*.key` を `~/.ssh/oci-lifetracer.pem` に移動 | ⬜ |
| 1.5.2 | パーミッション設定 (Linux/Mac) | `chmod 600 ~/.ssh/oci-lifetracer.pem` | ⬜ |
| 1.5.2' | パーミッション設定 (Windows) | icacls で権限制限 | ⬜ |
| 1.5.3 | SSH config 編集 | `~/.ssh/config` に設定追加 | ⬜ |
| 1.5.4 | 接続テスト | `ssh lifetracer` | ⬜ |
| 1.5.5 | 初回接続確認 | fingerprint確認後 yes | ⬜ |

### SSH config

```ssh_config
# ~/.ssh/config
Host lifetracer
  HostName <VM_PUBLIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/oci-lifetracer.pem
  ServerAliveInterval 60
```

### Windows パーミッション設定

```powershell
# PowerShell
icacls "$env:USERPROFILE\.ssh\oci-lifetracer.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

### 接続確認

```bash
$ ssh lifetracer
Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.x.x aarch64)
...
ubuntu@lifetracer-vm:~$
```

---

## Step 1.6: 初期システム確認

**目的:** VMの基本状態を確認

### タスク

| # | タスク | コマンド | 状態 |
|---|--------|---------|------|
| 1.6.1 | OS確認 | `cat /etc/os-release` | ⬜ |
| 1.6.2 | アーキテクチャ確認 | `uname -m` (aarch64) | ⬜ |
| 1.6.3 | CPU確認 | `nproc` (4) | ⬜ |
| 1.6.4 | メモリ確認 | `free -h` (~24GB) | ⬜ |
| 1.6.5 | ディスク確認 | `df -h` (~50GB) | ⬜ |
| 1.6.6 | ネットワーク確認 | `ip addr` | ⬜ |
| 1.6.7 | インターネット接続確認 | `curl -I https://google.com` | ⬜ |

---

## 完了チェックリスト

- [ ] 旧リソース (superset-vm, superset-nsg, vcn) が削除された
- [ ] lifetracer-vcn が作成された
- [ ] lifetracer-vm が RUNNING 状態
- [ ] VM スペック: 4 OCPU / 24 GB / Ubuntu 24.04 ARM
- [ ] Public IP が割り当てられている
- [ ] 秘密鍵が `~/.ssh/oci-lifetracer.pem` に配置された
- [ ] `~/.ssh/config` に設定が追加された
- [ ] `ssh lifetracer` で接続成功
- [ ] VM でインターネット接続確認済み

---

## 次のステップ

→ [Phase 2: VM環境構築](./infra-phase-2-vm-setup)
