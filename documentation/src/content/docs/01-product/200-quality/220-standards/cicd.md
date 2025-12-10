---
title: CI/CD 設計
description: 継続的インテグレーション・デリバリーの設計
---

# CI/CD 設計

## 方針

GitHub Actions を CI/CD 基盤として使用する。PR 時に lint・テスト・ビルドを自動実行し、main マージで自動デプロイする。パイプライン構成は「lint → test → build → deploy」の4段階。デプロイ先は console が Vercel、documentation が GitHub Pages、pipelines/transform は GitHub Actions 上で直接実行。シークレットは GitHub Secrets と Supabase Vault で管理し、環境ごとに分離する。
