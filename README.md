# TG Ad Manager V1.1

TG Ad Manager 是 Telegram 广告管理 SaaS 的工程基线，按多租户、可审计、可恢复、真实外部服务分层建设。当前阶段聚焦 Cloudflare 生产 schema adapter，避免把开发环境的旧 `ad_*` 契约直接部署到真实 D1。

## 当前阶段

已完成 Cloudflare 账户、D1、Queue 和 Worker 资源的只读审计，并确认目标 D1 已存在独立 production schema。发布 Cron 已支持通过 `D1_SCHEMA_CONTRACT=production-0008` 选择生产发布适配器，适配 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`creative_media` 和 `telegram_channel_permissions`。

当前没有把未配置的 Telegram、Cloudflare Worker、Queues、Cron、R2 或订单/收入数据伪装成已完成。认证、媒体、CRM、付款等 API 仍需继续适配生产 schema，真实外部联调按 `TODO.md` 分阶段推进。

## 开发

```bash
pnpm install
pnpm cf:config:check
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
- `PRODUCTION_INTEGRATION.md`：Cloudflare 生产资源审计和部署边界。
- `DATABASE_SCHEMA.md`：仓库表边界、约束和迁移说明。
- `API_SPEC.md`：已实现与计划 API。
- `DEPLOYMENT.md`：本地基线、生产配置和 Cloudflare 操作顺序。
- `TEST_REPORT.md`：实际测试命令和外部联调边界。
- `KNOWN_ISSUES.md`：未配置的外部依赖与当前限制。
- `docs/production-schema-adapter.md`：生产 D1 发布契约适配说明。
