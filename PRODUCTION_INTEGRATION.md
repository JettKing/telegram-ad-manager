# Production Integration — Stage 9–14 / production-0009

> 下文为阶段 9–14 的历史记录，资源状态不代表当前线上状态。2026-11-21 的最新核对和迁移安全边界以 `PROJECT_STATUS.md`、`DEPLOYMENT.md` 与 `apps/api/production-migrations/README.md` 为准；历史 0009 SQL 现已移至归档目录，不得盲目重放。

## 只读审计结果

Cloudflare 账户 `bf9869d76a7fcbd9f75aefc5f98f3fbb` 的目标 D1 为 `tg-ad-manager` / `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`，目标 Queue 为 `tg-ad-manager-publish` / `9fc8423242564c1e814108cdf5883208`。D1 已存在 40 张生产表；Queue 已存在但没有 producer 或 consumer；Worker `tg-ad-manager-api` 尚未创建。

## 阶段 11 已接入

在 `D1_SCHEMA_CONTRACT=production-0009` 下，API 现在按环境选择 production adapter：

- identity/session：`users.telegram_username`、tenant/workspace membership、`user_sessions.token_hash`。
- channels：`telegram_channels` 和 `telegram_channel_permissions`。
- CRM/business：`ad_customers`、`ad_packages`、`ad_orders`、`ad_creatives`、`creative_media`。
- finance：`payment_submissions` 和 `financial_ledger_entries`。
- Telegram webhook：生产 `telegram_updates` 与 `telegram_webhook_logs` 字段。

阶段 10 的 `production-publishing.ts` 继续负责 Cron 发布路径。

## 安全阻塞

已应用 `apps/api/production-migrations/0009_media_ingestion.sql` 的等价生产增量：`creative_media.telegram_message_id/source_chat_id`、唯一幂等索引、`media_groups`、`media_group_items` 及查询索引；媒体 Webhook 已切换到生产实现。生产 schema 当前没有可确认的退款申请表和订阅表，相关接口继续安全返回 schema unavailable。Queue consumer 尚未接入，当前发布路径依赖 Cron。

## 本地门禁

`pnpm typecheck`、`pnpm lint`、`pnpm test`（39 tests）、`pnpm build` 和 `wrangler deploy --dry-run` 均通过。

## 生产安全边界

本阶段已执行 D1 增量写入；未执行 Secret 写入、Worker 实际上传、Cron 运行验证或 Telegram Webhook 切换。Worker 实际上传的唯一阻塞是 Wrangler OAuth CAPTCHA 无法完成。
