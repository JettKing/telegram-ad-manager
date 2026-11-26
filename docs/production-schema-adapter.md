# Production Schema Adapter

阶段 10 新增 `apps/api/src/production-publishing.ts`，针对 Cloudflare D1 真实生产 schema 提供独立发布适配器。它不使用仓库旧的 `ad_publish_tasks`、`ad_publish_logs`、`planned_at` 或 `media_assets`。

生产适配器使用 `publish_tasks` 的 `available_at`/`locked_at`/`completed_at`/`telegram_message_ids_json` 字段，使用 `publish_task_logs` 记录每次 attempt，使用 `ad_schedules.start_at/end_at/timezone/repeat_until`，并从 `ad_orders.content_text/media_type/media_file_id/media_items_json` 和 `creative_media` 生成 Telegram 发布 payload。

生产频道发布权限通过 `telegram_channel_permissions.can_post_messages` 查询。成功发布会把全部 Telegram message IDs 写入 JSON，更新任务为 succeeded、订单为 published；重试使用 available_at 和 max_attempts，最终失败使用 dead_letter 或 uncertain。到期处理逐个删除保存的 message IDs，成功后订单为 completed。

Workers scheduled handler 读取 `D1_SCHEMA_CONTRACT=production-0009` 时选择生产适配器；未设置时保留本地旧适配器，避免开发数据库契约被静默切换。生产增量迁移位于 `apps/api/production-migrations/`，不得把 `apps/api/migrations/` 当作线上 schema 的重建证明。

本阶段只完成代码适配和本地验证，没有对 Cloudflare D1 执行写入，也没有上传 Worker 或设置 Telegram Secrets。
