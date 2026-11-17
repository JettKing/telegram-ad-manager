# TG Ad Manager V1.1

TG Ad Manager 是 Telegram 广告管理 SaaS 的工程基线，按多租户、可审计、可恢复、真实外部服务分层建设。当前已完成阶段 1 工程基础、阶段 2 Telegram 认证/Webhook 代码基线和阶段 3 用户 upsert、平台会话、RBAC 代码基线。

## 当前阶段

Telegram Mini App initData 已支持真实 HMAC-SHA256 验签；认证成功后可通过 D1 repository 幂等创建用户、默认租户/工作空间和 Owner 成员关系，并签发可撤销的 HMAC Bearer Session。`/api/v1/auth/me`、`/api/v1/auth/logout`、`/api/v1/workspace/context` 和 `/api/v1/finance/access` 已提供受保护边界。

当前没有把未配置的 Telegram、Cloudflare D1、Queues、Cron、R2 或订单/收入数据伪装成已完成。真实外部联调与业务模块仍按 `TODO.md` 分阶段推进。

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

平台会话需要在受保护环境配置 `SESSION_SECRET`；Telegram 认证还需要 `TELEGRAM_BOT_TOKEN`，生产持久化需要 Cloudflare D1 binding。客户端使用 `Authorization: Bearer <session.token>`，不要把 Bot Token 或 Session Secret 放在前端。

## 文档

- `plan.md`：实施、架构和 UI 设计计划。
- `TODO.md`：按阶段拆分的验收任务。
- `PROJECT_STATUS.md`：真实当前状态。
- `DATABASE_SCHEMA.md`：表边界、约束和迁移说明。
- `API_SPEC.md`：已实现与计划 API。
- `DEPLOYMENT.md`：本地基线与 Cloudflare 目标部署条件。
- `TEST_REPORT.md`：实际测试命令和外部联调边界。
- `KNOWN_ISSUES.md`：未配置的外部依赖与当前限制。
