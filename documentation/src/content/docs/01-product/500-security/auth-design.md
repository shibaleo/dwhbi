---
title: 認証・認可設計
description: 認証方式とアクセス制御の設計
---

# 認証・認可設計

## 方針

console へのアクセスは Supabase Auth（メール + パスワード）で認証し、初回登録ユーザーをオーナーとして扱う。外部サービスへの認証は OAuth 2.0/1.0a または API Key を使用し、トークンは Supabase Vault に暗号化保存する。DB アクセスは RLS（Row Level Security）で制御し、service_role キーは GitHub Actions からのみ使用可能とする。認可は「オーナーのみ全操作可能」のシンプルなモデルを採用。
