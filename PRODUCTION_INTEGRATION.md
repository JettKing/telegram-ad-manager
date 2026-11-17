# Production Integration — Stage 9–11

## 只读审计结果

Cloudflare 账户 `bf9869d76a7fcbd9f75aefc5f98f3fbb` 的目标 D1 为 `tg-ad-manager` / `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`，目标 Queue 为 `tg-ad-manager-publish` / `9fc8423242564c1e814108cdf5883208`。审计时 Worker `tg-ad-manager-api` 尚未创建，Queue 没有 producer 或 consumer；核心业务表行数为 0。

## 阶段 11 已接入

在 `D1_SCHEMA_CONTRACT=production-0008` 下，API 现在按环境选择 production adapter：

- identity/session：`users.telegram_username`、tenant/workspace membership、`user_sessions.token_hash`。
- channels：`telegram_channels` 和 `telegram_channel_permissions`。
- CRM/business：`ad_customers`、`ad_packages`、`ad_orders`、`ad_creatives`、`creative_media`。
- finance：`payment_submissions` 和 `financial_ledger_entries`。
- Telegram webhook：生产 `telegram_updates` 与 `telegram_webhook_logs` 字段。

阶段 10 的 `production-publishing.ts` 继续负责 Cron 发布路径。

## 安全阻塞

生产 `creative_media` 当前没有 Telegram source message/chat 幂等字段，不能安全承接 Webhook 媒体写入；生产 schema 当前没有可确认的退款申请表，退款 API 返回 `REFUND_SCHEMA_UNAVAILABLE`；排期 HTTP API 还需切换到生产发布 adapter。以上路径不会用旧表名“猜测写入”。

## 本地门禁

`pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`（33 tests）、`pnpm build` 均通过。

## 生产安全边界

本阶段没有执行 D1 写入、migration、Queue 创建、Worker 上传、Secret 写入或 Telegram Webhook 切换。
