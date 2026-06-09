import { defineConfig } from 'vitepress'

const base = process.env.VITEPRESS_BASE ?? '/'

export default defineConfig({
  lang: 'zh-CN',
  title: 'AI Agent 面试手册',
  description: 'LoRA、Transformer、RAG、vLLM、Agent 框架与评测的面试复盘笔记。',
  base,
  // Keep cleanUrls disabled for VitePress 1.6.x. In this project, enabling it
  // with directory index pages can trigger an SSR "imports" rendering error.

  head: [
    ['link', { rel: 'icon', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#0f172a' }],
    ['meta', { property: 'og:title', content: 'AI Agent 面试手册' }],
    ['meta', { property: 'og:description', content: '面向 AI Agent / RAG / LLM 工程岗位的结构化面试题库。' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Agent Interview',

    nav: [
      { text: '首页', link: '/' },
      { text: '总览', link: '/interview/' },
      {
        text: '专题',
        items: [
          { text: 'LoRA 微调', link: '/interview/lora/' },
          { text: 'Transformer 基础', link: '/interview/transformer/' },
          { text: '推理优化', link: '/interview/inference/' },
          { text: 'RAG 检索增强', link: '/interview/rag/' },
          { text: '训练与对齐', link: '/interview/alignment/' },
          { text: 'Agent 工程', link: '/interview/agent/' },
          { text: '项目实战复盘', link: '/interview/project/' },
          { text: '项目完整架构', link: '/interview/project/architecture-overview' },
          { text: '项目技术决策', link: '/interview/project/architecture-decisions' },
          { text: '项目简历追问', link: '/interview/project/resume-qa' },
          { text: 'Skill 与 MCP', link: '/interview/mcp/' },
        ],
      },
    ],

    sidebar: {
      '/interview/': [
        {
          text: '学习路径',
          collapsed: false,
          items: [
            { text: '面试题总览', link: '/interview/' },
          ],
        },
        {
          text: '模型训练与结构',
          collapsed: false,
          items: [
            { text: 'LoRA 微调', link: '/interview/lora/' },
            { text: 'Transformer 基础', link: '/interview/transformer/' },
            { text: '训练与对齐', link: '/interview/alignment/' },
          ],
        },
        {
          text: '工程与检索',
          collapsed: false,
          items: [
            { text: '推理优化', link: '/interview/inference/' },
            { text: 'RAG 检索增强', link: '/interview/rag/' },
            { text: 'Agent 工程', link: '/interview/agent/' },
            { text: '项目实战复盘', link: '/interview/project/' },
            { text: '项目完整架构', link: '/interview/project/architecture-overview' },
            { text: '项目技术决策', link: '/interview/project/architecture-decisions' },
            { text: '项目简历追问', link: '/interview/project/resume-qa' },
            { text: 'Skill 与 MCP', link: '/interview/mcp/' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/shadowhunt-yi/agentInterview' },
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索题目', buttonAriaLabel: '搜索题目' },
          modal: {
            displayDetails: '显示详情',
            resetButtonTitle: '清除搜索',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到相关内容',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: 'Enter',
              navigateText: '切换',
              navigateUpKeyAriaLabel: 'Arrow up',
              navigateDownKeyAriaLabel: 'Arrow down',
              closeText: '关闭',
              closeKeyAriaLabel: 'Escape',
            },
          },
        },
      },
    },

    outline: {
      label: '本页目录',
      level: [2, 3],
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short',
      },
    },

    footer: {
      message: 'Built for focused AI engineering interview prep.',
      copyright: 'Copyright © 2026',
    },
  },

  markdown: {
    lineNumbers: true,
  },

  lastUpdated: true,
})
