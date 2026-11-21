# PROJECT_STATUS

## 2026-11-21 只读复核

- Cloudflare 生产 Worker 与 Pages 项目均存在；Worker 绑定了 D1、Queue、四项 Secret 名称并配置五分钟 Cron，前端和 API 健康接口均返回 HTTP 200。未读取或修改 Secret、业务记录、Webhook 或生产配置。
- 生产 D1 的媒体字段和相册表存在，但 `d1_migrations` 仅记录 `0001_core_foundation.sql`，未记录 0009。生产 schema 与开发迁移链不同，当前不能安全地把后者应用到生产；历史媒体 SQL 已归档，不得重放。
- 生产 D1 缺少仓库登录路径依赖的 `telegram_init_data_replays` 表；修复分支修正 HMAC 算法后，仍需经过隔离测试与审批的 schema 方案才能验证真实登录。
- 健康检查、构建和单元测试不证明 Telegram 登录、付款或发布等业务链路已真实验收。订单财务状态绕过、部分付款和取消后发布等问题仍需处理；详情见 `KNOWN_ISSUES.md`。

## 当前状态

阶段 14 已完成订阅审核、付款确认、续费/到期处理和基础权益强制执行。阶段 13 的 SaaS 订阅基础、阶段 12 的生产排期 HTTP API，以及 Telegram 登录身份、频道绑定、CRM、订单、付款和 Webhook 能力均保留。旧开发 schema 仍保留，默认 contract 不变。

## 已完成

- `production-identity.ts`：适配 `users.telegram_username`、`tenant_members`、带 tenant_id/status 的 `workspace_members`，以及生产 `user_sessions.token_hash/last_seen_at`。
- `production-channels.ts`：适配 `telegram_channels` 与 `telegram_channel_permissions`，保持租户/工作空间隔离和绑定冲突保护。
- `production-business.ts`：适配 `ad_customers`、`ad_packages`、`ad_orders`、`ad_creatives`、`creative_media`，覆盖 CRM、套餐、订单创建、内容更新和状态迁移。
- `production-payments.ts`：适配 `payment_submissions` 与 `financial_ledger_entries`，覆盖凭证提交、Finance 审核和付款流水。
- `ProductionD1WebhookUpdateStore`：适配生产 `telegram_updates.processing_status` 与 `telegram_webhook_logs.response_code/request_id`。
- `production-media.ts`：已适配生产素材读取、Telegram message_id/source_chat_id 幂等写入和相册状态机；生产 D1 已应用 `production-0009` 增量 schema。
- `production-publishing.ts`：排期列表、发布任务列表和创建排期 HTTP API 与 Workers Cron 共用同一生产仓储，避免 API 与 Cron 使用不同字段契约。
- `subscription.ts` 与 Migration 0011：提供订阅计划、租户订阅、权益额度、月度用量、幂等升级请求；付费升级保持 pending，不伪造支付完成。
- 阶段 14：平台管理员白名单审核升级请求；通过后切换订阅、写入 `financial_transactions` 和 `subscription_events`；Cron 处理 FREE 自动续费与付费订阅到期；订单和频道绑定执行额度检查。

## 历史检查记录

以下为 2026-11-18 阶段文档原记录；2026-11-21 实测发现原始 `cf:config:check` 会错误截断 HTTPS URL，并不能复现当时“通过”的结论。当前分支已修复解析器，实际本地验证见 `TEST_REPORT.md`。

- `pnpm cf:config:check`：通过。
- `pnpm db:check`：通过，11 份本地 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，10 个测试文件、39 个测试。
- `pnpm build`：通过。
- GitHub Actions CI：通过，提交 `d17c6dd`。
- Cloudflare Worker：已部署至 `https://tg-ad-manager-api.huaaplus.workers.dev`，D1、Telegram Secret、Cron 和 Queue producer 已配置。
- Cloudflare Pages：已部署至 `https://telegram-ad-manager.pages.dev`，前端构建通过并已指向线上 Worker API。
- Telegram Bot `@TGAdOpsBot`：已创建生产 Bot 身份，Webhook 已注册并通过 Telegram `getWebhookInfo` 验证。

## 尚未完成

退款 API 因生产 D1 当前未发现退款申请表而安全返回 `REFUND_SCHEMA_UNAVAILABLE`；订阅表、平台管理员白名单和订阅 Cron 目前只接入本地 schema。真实频道绑定、素材入库和发布流程仍需使用测试频道完成业务联调。
