import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'DWH+BI',
  description: '個人データ統合基盤',
  base: '/dwhbi/',
  lang: 'ja',
  lastUpdated: true,
  ignoreDeadLinks: false,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Product', link: '/01-product/100-development/110-requirements/111-business' },
      { text: 'Project', link: '/02-project/300-management/320-tracking/implementation' },
    ],

    sidebar: {
      '/': [
        {
          text: 'はじめに',
          items: [
            { text: '概要', link: '/' },
            { text: '実装状況', link: '/02-project/300-management/320-tracking/implementation' },
            { text: 'ロードマップ', link: '/02-project/300-management/310-planning/roadmap' },
          ]
        },
        // ========== Product ==========
        {
          text: 'Product',
          collapsed: false,
          items: [
            {
              text: '000 背景・基礎',
              collapsed: true,
              items: [
                {
                  text: '010 理論',
                  collapsed: true,
                  items: [
                    { text: 'QPIモデル', link: '/01-product/000-foundations/010-theory/011-qpi-model' },
                    { text: '用語集', link: '/01-product/000-foundations/010-theory/012-terminology' },
                    { text: '設計的責務台帳', link: '/01-product/000-foundations/010-theory/013-designative-liability-registry' },
                  ]
                },
                {
                  text: '020 実装哲学',
                  collapsed: true,
                  items: [
                    { text: '設計哲学', link: '/01-product/000-foundations/020-philosophy/021-design-philosophy' },
                    { text: 'ユーザーフォーカス', link: '/01-product/000-foundations/020-philosophy/022-user-focus' },
                    { text: 'QPI実装', link: '/01-product/000-foundations/020-philosophy/023-qpi-implementation' },
                    { text: 'DWH 4層アーキテクチャ', link: '/01-product/000-foundations/020-philosophy/024-dwh-architecture' },
                  ]
                },
              ]
            },
            {
              text: '100 開発',
              collapsed: true,
              items: [
                {
                  text: '110 要件定義',
                  collapsed: true,
                  items: [
                    { text: '業務要件', link: '/01-product/100-development/110-requirements/111-business' },
                    { text: '機能要件', link: '/01-product/100-development/110-requirements/112-functional' },
                    { text: '非機能要件', link: '/01-product/100-development/110-requirements/113-non-functional' },
                  ]
                },
                {
                  text: '120 仕様書',
                  collapsed: true,
                  items: [
                    {
                      text: '121 全体',
                      collapsed: true,
                      items: [
                        { text: 'システム概要', link: '/01-product/100-development/120-specifications/121-overview/overview' },
                        { text: 'DWH 4層設計', link: '/01-product/100-development/120-specifications/121-overview/dwh-layers' },
                        { text: 'リポジトリ構成', link: '/01-product/100-development/120-specifications/121-overview/repository-structure' },
                        { text: 'セキュリティ', link: '/01-product/100-development/120-specifications/121-overview/security' },
                      ]
                    },
                    {
                      text: '122 pipelines（データ取得）',
                      collapsed: true,
                      items: [
                        { text: 'Toggl Track', link: '/01-product/100-development/120-specifications/122-pipelines/services/toggl-track' },
                        { text: 'Google Calendar', link: '/01-product/100-development/120-specifications/122-pipelines/services/google-calendar' },
                        { text: 'Fitbit', link: '/01-product/100-development/120-specifications/122-pipelines/services/fitbit' },
                        { text: 'Zaim', link: '/01-product/100-development/120-specifications/122-pipelines/services/zaim' },
                        { text: 'Tanita Health Planet', link: '/01-product/100-development/120-specifications/122-pipelines/services/tanita-health-planet' },
                        { text: 'Trello', link: '/01-product/100-development/120-specifications/122-pipelines/services/trello' },
                        { text: 'TickTick', link: '/01-product/100-development/120-specifications/122-pipelines/services/ticktick' },
                        { text: 'Airtable', link: '/01-product/100-development/120-specifications/122-pipelines/services/airtable' },
                      ]
                    },
                    {
                      text: '123 transform（データ変換）',
                      collapsed: true,
                      items: [
                        { text: 'time_records_actual', link: '/01-product/100-development/120-specifications/123-transform/schema/core/001-time-records-actual' },
                        { text: 'time_records_plan', link: '/01-product/100-development/120-specifications/123-transform/schema/core/002-time-records-plan' },
                        { text: 'time_records_unified', link: '/01-product/100-development/120-specifications/123-transform/schema/core/003-time-records-unified' },
                        { text: 'target', link: '/01-product/100-development/120-specifications/123-transform/schema/core/004-target' },
                        { text: 'estimate', link: '/01-product/100-development/120-specifications/123-transform/schema/core/005-estimate' },
                      ]
                    },
                    {
                      text: '124 console（管理コンソール）',
                      collapsed: true,
                      items: [
                        { text: 'ダッシュボード', link: '/01-product/100-development/120-specifications/124-console/console-dashboard' },
                      ]
                    },
                    {
                      text: '125 analyzer（ML分析）',
                      collapsed: true,
                      items: [
                        { text: '概要', link: '/01-product/100-development/120-specifications/125-analyzer/overview' },
                        {
                          text: 'time（時間）',
                          collapsed: true,
                          items: [
                            { text: '予測', link: '/01-product/100-development/120-specifications/125-analyzer/time/001-estimation' },
                            { text: '目標調整', link: '/01-product/100-development/120-specifications/125-analyzer/time/002-adjust-target-by-estimate' },
                            { text: '目標分割', link: '/01-product/100-development/120-specifications/125-analyzer/time/003-breakdown-long-target' },
                            { text: '計画自動生成', link: '/01-product/100-development/120-specifications/125-analyzer/time/004-autogenerate-plan' },
                          ]
                        },
                        {
                          text: 'health（健康）',
                          collapsed: true,
                          items: [
                            { text: '推定', link: '/01-product/100-development/120-specifications/125-analyzer/health/001-estimate' },
                          ]
                        },
                      ]
                    },
                  ]
                },
                {
                  text: '130 設計書',
                  collapsed: true,
                  items: [
                    { text: 'システムアーキテクチャ', link: '/01-product/100-development/130-design/architecture' },
                    { text: 'データベーススキーマ', link: '/01-product/100-development/130-design/database-schema' },
                    { text: 'Toggl Track コネクタ', link: '/01-product/100-development/130-design/connector-toggl-track' },
                    { text: 'Google Calendar コネクタ', link: '/01-product/100-development/130-design/connector-google-calendar' },
                    {
                      text: '131 ADR',
                      collapsed: true,
                      items: [
                        { text: 'ADR-001 リリース戦略', link: '/01-product/100-development/130-design/131-decisions/adr_001-release-strategy' },
                        { text: 'ADR-002 分析軸マスタ設計', link: '/01-product/100-development/130-design/131-decisions/adr_002-ref-schema-design' },
                        { text: 'ADR-003 フィードバックループ', link: '/01-product/100-development/130-design/131-decisions/adr_003-feedback-loop' },
                        { text: 'ADR-004 day_type設計', link: '/01-product/100-development/130-design/131-decisions/adr_004-day-type-design' },
                        { text: 'ADR-005 モノレポ構成', link: '/01-product/100-development/130-design/131-decisions/adr_005-monorepo-structure' },
                        { text: 'ADR-006 ドキュメント構成', link: '/01-product/100-development/130-design/131-decisions/adr_006-documentation-structure' },
                        { text: 'ADR-007 インフラ配置', link: '/01-product/100-development/130-design/131-decisions/adr_007-infrastructure-layout' },
                      ]
                    },
                  ]
                },
              ]
            },
            {
              text: '200 品質',
              collapsed: true,
              items: [
                {
                  text: '210 テスト計画',
                  collapsed: true,
                  items: [
                    { text: 'テスト概要', link: '/01-product/200-quality/210-test/index' },
                    { text: '単体テスト', link: '/01-product/200-quality/210-test/unit' },
                    { text: '結合テスト', link: '/01-product/200-quality/210-test/integration' },
                    { text: 'システムテスト', link: '/01-product/200-quality/210-test/system' },
                    { text: 'E2Eテスト', link: '/01-product/200-quality/210-test/e2e' },
                  ]
                },
                {
                  text: '220 品質基準',
                  collapsed: true,
                  items: [
                    { text: 'コーディング規約', link: '/01-product/200-quality/220-standards/standards' },
                    { text: 'コードレビュー', link: '/01-product/200-quality/220-standards/code-review' },
                    { text: 'スキーマ契約', link: '/01-product/200-quality/220-standards/schema-contracts' },
                    { text: 'CI/CD', link: '/01-product/200-quality/220-standards/cicd' },
                  ]
                },
              ]
            },
            {
              text: '400 運用',
              collapsed: true,
              items: [
                {
                  text: '410 ガイド',
                  collapsed: true,
                  items: [
                    { text: 'セットアップ', link: '/01-product/400-operations/410-guides/setup' },
                    { text: '運用手順書', link: '/01-product/400-operations/410-guides/runbook' },
                  ]
                },
                {
                  text: '420 運用手順',
                  collapsed: true,
                  items: [
                    { text: '監視', link: '/01-product/400-operations/420-runbook/monitoring' },
                    { text: 'バックアップ', link: '/01-product/400-operations/420-runbook/backup' },
                    { text: 'インシデント対応', link: '/01-product/400-operations/420-runbook/incident' },
                  ]
                },
                {
                  text: '430 運用リスク',
                  collapsed: true,
                  items: [
                    { text: 'サービス依存性', link: '/01-product/400-operations/430-risk/service-dependency' },
                  ]
                },
              ]
            },
            {
              text: '500 セキュリティ',
              collapsed: true,
              items: [
                { text: '脅威モデリング', link: '/01-product/500-security/threat-model' },
                { text: '認証設計', link: '/01-product/500-security/auth-design' },
              ]
            },
          ]
        },
        // ========== Project ==========
        {
          text: 'Project',
          collapsed: true,
          items: [
            {
              text: '300 管理',
              collapsed: true,
              items: [
                {
                  text: '310 計画',
                  collapsed: true,
                  items: [
                    { text: 'ロードマップ', link: '/02-project/300-management/310-planning/roadmap' },
                    { text: '移行計画', link: '/02-project/300-management/310-planning/migration-plan' },
                    { text: 'インフラ計画', link: '/02-project/300-management/310-planning/infrastructure-plan' },
                    { text: 'Phase 1: OCI VM', link: '/02-project/300-management/310-planning/infra-phase-1-oci-vm' },
                    { text: 'Phase 2: VMセットアップ', link: '/02-project/300-management/310-planning/infra-phase-2-vm-setup' },
                    { text: 'Phase 3: infraディレクトリ', link: '/02-project/300-management/310-planning/infra-phase-3-infra-directory' },
                    { text: 'Phase 4: serverパッケージ', link: '/02-project/300-management/310-planning/infra-phase-4-server-package' },
                    { text: 'Phase 5: Cloudflare Tunnel', link: '/02-project/300-management/310-planning/infra-phase-5-cloudflare-tunnel' },
                    { text: 'Phase 6: consoleデプロイ', link: '/02-project/300-management/310-planning/infra-phase-6-console-deploy' },
                    { text: 'Phase 7: cron設定', link: '/02-project/300-management/310-planning/infra-phase-7-cron-setup' },
                    { text: 'Phase 8: GitHub Actions', link: '/02-project/300-management/310-planning/infra-phase-8-github-actions' },
                    { text: 'Phase 9: 統合テスト', link: '/02-project/300-management/310-planning/infra-phase-9-integration-test' },
                  ]
                },
                {
                  text: '320 進捗',
                  collapsed: true,
                  items: [
                    { text: '実装状況', link: '/02-project/300-management/320-tracking/implementation' },
                    { text: '変更履歴', link: '/02-project/300-management/320-tracking/changelog' },
                    { text: '移行Phase 1', link: '/02-project/300-management/320-tracking/migration-phase-1' },
                    { text: '移行Phase 2', link: '/02-project/300-management/320-tracking/migration-phase-2' },
                    { text: '移行Phase 3', link: '/02-project/300-management/320-tracking/migration-phase-3' },
                    { text: '移行Phase 4', link: '/02-project/300-management/320-tracking/migration-phase-4' },
                    { text: '移行Phase 5', link: '/02-project/300-management/320-tracking/migration-phase-5' },
                    { text: '移行Phase 6', link: '/02-project/300-management/320-tracking/migration-phase-6' },
                    { text: '移行Phase 7', link: '/02-project/300-management/320-tracking/migration-phase-7' },
                    { text: '移行Phase 8', link: '/02-project/300-management/320-tracking/migration-phase-8' },
                  ]
                },
                {
                  text: '330 プロジェクト管理',
                  collapsed: true,
                  items: [
                    { text: 'WBS', link: '/02-project/300-management/330-project/wbs' },
                    { text: 'バックログ', link: '/02-project/300-management/330-project/backlog' },
                    { text: 'Issues', link: '/02-project/300-management/330-project/issues' },
                    { text: 'リスク', link: '/02-project/300-management/330-project/risk' },
                  ]
                },
              ]
            },
          ]
        },
        // ========== Knowledge ==========
        {
          text: 'Knowledge',
          collapsed: true,
          items: [
            { text: '技術スタック', link: '/03-knowledge/technology-stack' },
          ]
        },
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/shibaleo/dwhbi' }
    ],

    editLink: {
      pattern: 'https://github.com/shibaleo/dwhbi/edit/main/documentation/docs/:path'
    },

    search: {
      provider: 'local'
    },

    outline: {
      level: [2, 3]
    }
  }
})
