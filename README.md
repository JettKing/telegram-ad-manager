# TG Ad Manager V1.1

TG Ad Manager 是 Telegram 广告管理 SaaS 的工程基线。它按多租户、可审计、可恢复、真实外部服务分层建设，目标包含 Telegram Bot、Mini App、Web 超级管理员后台、D1 Migration、队列任务和订阅商业化。

## 当前阶段

当前是阶段 1 工程基础。已提供可运行的 React/Vite 工作台、Hono API 健康探针、共享 TypeScript 契约、Telegram 身份校验边界、D1/SQLite Migration、CI 检查和项目文档。业务入口会明确显示待接入状态，不使用固定订单或收入数字制造运营效果。

## 开发

```bash
pnpm install
pnpm db:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

前端监听 3000，API 监听 8787。浏览器可访问 `/`，健康接口为 `/health`、`/health/ready`、`/api/v1/health`，页面路由清单为 `/manus-routes.json`。

## 文档

- `plan.md`：实施、架构和 UI 设计计划。
- `TODO.md`：按阶段拆分的完整验收任务。
- `PROJECT_STATUS.md`：真实当前状态。
- `DATABASE_SCHEMA.md`：表边界、约束和迁移说明。
- `API_SPEC.md`：已实现与计划 API。
- `DEPLOYMENT.md`：本地基线与 Cloudflare 目标部署条件。
- `TEST_REPORT.md`：实际测试命令和外部联调边界。
- `KNOWN_ISSUES.md`：未配置的外部依赖与当前限制。
