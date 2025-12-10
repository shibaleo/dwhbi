// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { rehypeBasePath } from './src/plugins/rehype-base-path.mjs';

const BASE_PATH = '/dwhbi';

// https://astro.build/config
export default defineConfig({
	site: 'https://shibaleo.github.io',
	base: BASE_PATH,
	markdown: {
		rehypePlugins: [[rehypeBasePath, { base: BASE_PATH }]],
	},
	integrations: [
		starlight({
			title: 'DWH+BI',
			description: '個人データ統合基盤',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/shibaleo/dwhbi' },
			],
			sidebar: [
				{
					label: 'はじめに',
					items: [
						{ label: '概要', link: '/' },
						{ label: '実装状況', slug: '300-management/320-tracking/implementation' },
						{ label: 'ロードマップ', slug: '300-management/310-planning/roadmap' },
					],
				},
				{
					label: '000 背景・基礎',
					items: [
						{
							label: '010 理論',
							autogenerate: { directory: '000-foundations/010-theory' },
						},
						{
							label: '020 実装哲学',
							autogenerate: { directory: '000-foundations/020-philosophy' },
						},
					],
				},
				{
					label: '100 開発',
					items: [
						{
							label: '110 要件定義',
							autogenerate: { directory: '100-development/110-requirements' },
						},
						{
							label: '120 仕様書',
							items: [
								{
									label: '121 全体',
									autogenerate: { directory: '100-development/120-specifications/121-overview' },
								},
								{
									label: '122 pipelines（データ取得）',
									autogenerate: { directory: '100-development/120-specifications/122-pipelines/services' },
								},
								{
									label: '123 transform（データ変換）',
									autogenerate: { directory: '100-development/120-specifications/123-transform/schema/core' },
								},
								{
									label: '124 console（管理コンソール）',
									autogenerate: { directory: '100-development/120-specifications/124-console' },
								},
								{
									label: '125 analyzer（ML分析）',
									items: [
										{ label: '概要', slug: '100-development/120-specifications/125-analyzer/overview' },
										{
											label: 'time（時間）',
											autogenerate: { directory: '100-development/120-specifications/125-analyzer/time' },
										},
										{
											label: 'health（健康）',
											autogenerate: { directory: '100-development/120-specifications/125-analyzer/health' },
										},
									],
								},
							],
						},
						{
							label: '130 設計書',
							items: [
								{ label: 'システムアーキテクチャ', slug: '100-development/130-design/architecture' },
								{ label: 'データベーススキーマ', slug: '100-development/130-design/database-schema' },
								{
									label: '131 ADR',
									autogenerate: { directory: '100-development/130-design/131-decisions' },
								},
							],
						},
					],
				},
				{
					label: '200 品質',
					items: [
						{
							label: '210 テスト計画',
							autogenerate: { directory: '200-quality/210-test' },
						},
						{
							label: '220 品質基準',
							autogenerate: { directory: '200-quality/220-standards' },
						},
					],
				},
				{
					label: '300 管理',
					items: [
						{
							label: '310 計画',
							autogenerate: { directory: '300-management/310-planning' },
						},
						{
							label: '320 進捗',
							autogenerate: { directory: '300-management/320-tracking' },
						},
						{
							label: '330 プロジェクト管理',
							autogenerate: { directory: '300-management/330-project' },
						},
					],
				},
				{
					label: '400 運用',
					items: [
						{
							label: '410 ガイド',
							autogenerate: { directory: '400-operations/410-guides' },
						},
						{
							label: '420 運用手順',
							autogenerate: { directory: '400-operations/420-runbook' },
						},
						{
							label: '430 運用リスク',
							autogenerate: { directory: '400-operations/430-risk' },
						},
					],
				},
				{
					label: '500 セキュリティ',
					autogenerate: { directory: '500-security' },
				},
			],
			editLink: {
				baseUrl: 'https://github.com/shibaleo/dwhbi/edit/main/documentation/',
			},
			lastUpdated: true,
		}),
	],
});
