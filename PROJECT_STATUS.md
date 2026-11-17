# PROJECT_STATUS

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

## 检查证据

- `pnpm cf:config:check`：通过。
- `pnpm db:check`：通过，11 份本地 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，10 个测试文件、39 个测试。
- `pnpm build`：通过。

## 尚未完成

退款 API 因生产 D1 当前未发现退款申请表而安全返回 `REFUND_SCHEMA_UNAVAILABLE`；订阅表、平台管理员白名单和订阅 Cron 目前只接入本地 schema。生产 Queue 已存在但没有 producer/consumer。Worker dry-run 已通过，实际上传因 Wrangler OAuth CAPTCHA 未完成而阻塞；Secrets、Cron 运行验证和 Telegram 真实联调仍未执行。
