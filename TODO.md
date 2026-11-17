# TG Ad Manager V1.1 任务清单

## 阶段 1–8：代码基线

阶段 1–8 的认证、RBAC、频道、媒体、CRM、订单、付款、退款、排期和发布队列代码基线已完成；本地门禁通过，真实外部联调依赖生产配置。

## 阶段 9：生产环境部署、Cloudflare 真实服务接入与联调

- [x] 只读盘点唯一授权 Cloudflare 账户、D1、Workers 和 Queues 资源。
- [x] 确认目标 D1 `tg-ad-manager` 与目标 Queue `tg-ad-manager-publish` 的真实 ID、状态和现有 schema。
- [x] 确认目标 D1 已有独立 0001–0008 production schema，且核心表当前没有业务数据。
- [x] 创建真实资源绑定的 `wrangler.production.jsonc`，不包含 Secret。
- [x] 增加 `pnpm cf:config:check`，阻止占位符和错误资源绑定进入部署流程。
- [ ] 完成仓库代码到 production schema 的 adapter：`publish_tasks`、`publish_task_logs`、`creative_media`、`payment_submissions`、生产 `ad_schedules` 字段。
- [ ] 补齐 Queue consumer、DLQ 策略和 queue_dispatched_at 状态闭环。
- [ ] 通过 Cloudflare Secret 配置 Telegram Token、Webhook Secret、Session Secret 和 Bot identity。
- [ ] 在明确确认后执行生产 D1 migration、创建 DLQ、上传 Worker、设置 Cron 和 Telegram Webhook。
- [ ] 使用真实测试频道完成 auth、channel binding、media ingest、publish、429 retry、expiration delete 联调。
- [ ] 保留每次生产操作的 Cloudflare 返回证据、Worker version、D1 migration 记录和 Telegram API 响应摘要。

## 生产安全边界

阶段 9 当前只执行了 Cloudflare 只读审计和本地配置准备，没有执行 D1 写入、migration、Worker 上传、Queue 创建、Secret 写入或 Webhook 切换。生产 D1 虽然当前业务数据为 0，仍不能跳过 schema 兼容性适配和变更确认。
