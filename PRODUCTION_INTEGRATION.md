# Production Integration — Stage 9

## 只读审计结果

2026-11-17 通过 Cloudflare MCP 对唯一授权账户 `bf9869d76a7fcbd9f75aefc5f98f3fbb` 执行只读盘点。目标 D1 是 `tg-ad-manager`，ID 为 `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`；目标队列是 `tg-ad-manager-publish`，ID 为 `9fc8423242564c1e814108cdf5883208`。当前账户没有名为 `tg-ad-manager-api` 的 Worker；队列当前没有 producer 或 consumer。

目标 D1 并非空库。查询结果显示已有 8 个 `schema_migrations` 版本，包含 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`ad_creatives`、`creative_media`、`payment_submissions` 等生产表，当前各核心业务表行数为 0，但结构已经存在。

## 关键兼容性结论

当前仓库阶段 1–8 的本地代码和 Migration 使用 `ad_publish_tasks`、`ad_publish_logs`、`media_assets`、`ad_order_payments` 等命名和字段；生产 D1 使用 `publish_tasks`、`publish_task_logs`、`creative_media`、`payment_submissions`。生产 `ad_schedules` 使用 `start_at/end_at/timezone/repeat_until`，本地发布器使用 `planned_at`。因此不能直接执行本地 `0010_publish_queue.sql` 或直接部署当前 Worker；这会导致 SQL 失败或业务状态错写。

当前生产 D1 中 `publish_tasks` 已有 `available_at`、`locked_at`、`completed_at`、`telegram_message_ids_json`、`queue_dispatched_at` 等更完整字段；生产 `ad_orders` 使用 `content_text/media_type/media_file_id/media_items_json`，生产频道权限在 `telegram_channel_permissions` 中，而不是 `telegram_channels.can_post`。这说明生产 schema 是更先进的独立契约，需要适配层而不是覆盖式迁移。

## 已完成的阶段 9 安全准备

新增 `wrangler.production.jsonc`，绑定真实账户、D1、队列和 5 分钟 Cron，但没有写入任何 Token 或 Secret。新增 `pnpm cf:config:check` 静态校验，防止部署文件回退到占位符。当前配置文件仅作为部署候选，不代表 Worker 已发布。

## 部署阻塞项

1. 需要先完成 production schema adapter，将本地发布器、付款和媒体查询改为生产表契约。
2. 需要创建并绑定 `tg-ad-manager-publish-dlq`，或从生产配置中移除 DLQ 声明后再部署。
3. 需要通过 Cloudflare Secrets 配置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`SESSION_SECRET`、`TELEGRAM_BOT_IDENTITY_ID`，不能放入 Git。
4. 需要补齐 Queue consumer handler；当前 Worker 只有 fetch 和 scheduled handler。
5. 需要用户确认后才能执行 D1 迁移、创建 DLQ、上传 Worker、设置 Telegram Webhook 和公开发布。

## 禁止事项

本阶段没有执行任何 D1 写入、迁移、队列创建、Worker 上传、Secret 写入或 Telegram Webhook 切换。生产 D1 当前数据量为 0，但不能以此替代变更确认。
