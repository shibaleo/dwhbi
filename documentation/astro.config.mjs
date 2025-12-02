// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'LIFETRACER',
			description: 'Personal Data Warehouse Platform - 60年運用を目指す個人データ基盤',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/your-repo/lifetracer' },
			],
			sidebar: [
				{
					label: 'はじめに',
					items: [
						{ label: '概要', link: '/' },
						{ label: 'ロードマップ', slug: 'roadmap' },
					],
				},
				{
					label: 'アーキテクチャ',
					autogenerate: { directory: 'architecture' },
				},
				{
					label: 'データソース',
					autogenerate: { directory: 'data-sources' },
				},
				{
					label: 'データベース',
					autogenerate: { directory: 'database' },
				},
				{
					label: '運用',
					autogenerate: { directory: 'operations' },
				},
			],
			editLink: {
				baseUrl: 'https://github.com/your-repo/lifetracer/edit/main/documentation/',
			},
			lastUpdated: true,
		}),
	],
});
