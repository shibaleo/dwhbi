// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://shibaleo.github.io',
	base: '/supabase-sync-jobs',
	integrations: [
		starlight({
			title: 'LIFETRACER',
			description: 'Personal Data Warehouse Platform - 個人ライフログ統合基盤',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/your-repo/lifetracer' },
			],
			sidebar: [
				{
					label: 'はじめに',
					items: [
						{ label: '概要', link: '/' },
						{ label: '実装状況', slug: 'status/implementation' },
						{ label: 'ロードマップ', slug: 'planning/roadmap' },
					],
				},
				{
					label: '要件定義',
					autogenerate: { directory: 'requirements' },
				},
				{
					label: '仕様書',
					items: [
						{ label: 'システム概要', slug: 'specifications/overview' },
						{ label: 'DWH 4層設計', slug: 'specifications/dwh-layers' },
						{ label: '管理ダッシュボード', slug: 'specifications/admin-dashboard' },
						{ label: '認証・セキュリティ', slug: 'specifications/security' },
						{
							label: 'サービス仕様',
							autogenerate: { directory: 'specifications/services' },
						},
					],
				},
				{
					label: '設計書',
					items: [
						{ label: 'システムアーキテクチャ', slug: 'design/architecture' },
						{ label: 'データベーススキーマ', slug: 'design/database-schema' },
						{
							label: 'ADR',
							autogenerate: { directory: 'design/decisions' },
						},
					],
				},
				{
					label: 'ガイド',
					autogenerate: { directory: 'guides' },
				},
				{
					label: '状況・計画',
					items: [
						{ label: '実装状況', slug: 'status/implementation' },
						{ label: '変更履歴', slug: 'status/changelog' },
						{ label: 'ロードマップ', slug: 'planning/roadmap' },
						{ label: 'バックログ', slug: 'planning/backlog' },
					],
				},
			],
			editLink: {
				baseUrl: 'https://github.com/your-repo/lifetracer/edit/main/documentation/',
			},
			lastUpdated: true,
		}),
	],
});
