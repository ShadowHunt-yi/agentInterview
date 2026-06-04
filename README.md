# AI Agent 面试手册

一个基于 VitePress 的 AI Agent / RAG / LLM 面试知识库。内容用 Markdown 维护，适合发布到 GitHub Pages。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物在 `docs/.vitepress/dist`。

VitePress 会生成 `docs/.vitepress/.temp`、`docs/.vitepress/cache` 和 `docs/.vitepress/dist`，这些都是构建产物，不应提交到仓库。

## 内容维护

- 首页：`docs/index.md`
- 面试题总览：`docs/interview/index.md`
- 专题页：`docs/interview/*/index.md`
- 项目复盘：`docs/interview/project/index.md`
- 导航和侧边栏：`docs/.vitepress/config.ts`
- 主题样式：`docs/.vitepress/theme/style.css`

新增内容建议：

1. 先放到已有专题页。
2. 如果专题变长，再拆成子目录。
3. 新页面创建后，在 `config.ts` 里补导航或侧边栏链接。

## GitHub Pages

已经提供 `.github/workflows/deploy.yml`。推送到 `main` 分支后，GitHub Actions 会自动构建并发布 Pages。

如果仓库发布地址是 `https://用户名.github.io/仓库名/`，workflow 会自动把 VitePress `base` 设置为 `/仓库名/`。

发布前必须在 GitHub 仓库设置里启用 Actions 发布：

```text
Settings -> Pages -> Build and deployment -> Source -> GitHub Actions
```

如果这里仍然是 `Deploy from a branch`，GitHub Pages 会继续发布仓库根目录，页面可能显示 `README.md`，而不是 VitePress 构建后的站点。

如果仓库尚未启用 Pages，可以选择手动按上面方式启用；也可以创建具备 Pages 管理权限的 secret `PAGES_TOKEN`，workflow 会用它尝试自动启用 Pages。
