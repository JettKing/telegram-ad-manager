# Production Integration — Stage 9–10

## 只读审计结果

2026-11-17 通过 Cloudflare MCP 对唯一授权账户 `bf9869d76a7fcbd9f75aefc5f98f3fbb` 执行只读盘点。目标 D1 是 `tg-ad-manager`，ID 为 `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`；目标队列是 `tg-ad-manager-publish`，ID 为 `9fc8423242564c1e814108cdf5883208`。当前账户没有名为 `tg-ad-manager-api` 的 Worker；队列当前没有 producer 或 consumer。

目标 D1 已有 0001–0008 production schema，包含 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`ad_creatives`、`creative_media`、`payment_submissions` 等表；核心业务表当前行数为 0。

## 阶段 10 adapter

新增 `apps/api/src/production-publishing.ts`，适配生产任务的 available_at/locked_at/completed_at/telegram_message_ids_json，生产排期的 start_at/end_at/timezone/repeat_until，生产订单内容和 creative_media，以及频道权限表 `telegram_channel_permissions`。

生产 Worker Cron 在 `D1_SCHEMA_CONTRACT=production-0008` 时选择该适配器。生产配置已移除尚未创建的 DLQ 声明，避免候选部署配置引用不存在资源。

## 关键兼容性结论

仓库其他阶段仍包含旧 schema 查询：`ad_publish_tasks`、`ad_publish_logs`、`media_assets`、`ad_order_payments` 和旧频道权限字段。因此当前 Worker 仍不能对整个应用直接生产发布；阶段 10 只把发布 Cron 的核心路径切换到真实 schema，认证、媒体、付款和 API 路由需继续适配。

## 生产安全边界

本阶段没有执行 D1 写入、migration、Queue 创建、Worker 上传、Secret 写入或 Telegram Webhook 切换。