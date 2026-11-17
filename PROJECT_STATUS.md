# PROJECT_STATUS

## 当前状态

阶段 10 已完成生产发布 schema adapter 的代码基线。本地 Workers Cron 在 `D1_SCHEMA_CONTRACT=production-0008` 时会选择生产适配器，避免直接使用本地 `ad_*` 发布表查询生产 D1。

## 生产适配器

`apps/api/src/production-publishing.ts` 使用生产 D1 的 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`ad_orders`、`creative_media` 和 `telegram_channel_permissions`。它实现生产排期创建、queued → processing 条件 claim、Telegram payload 装载、完整 message ID 写回、retry/dead_letter/uncertain 状态和到期删除。

生产排期字段使用 `start_at`、`end_at`、`timezone`、`repeat_until`；没有 endAt 的生产排期会被拒绝。生产素材优先读取 `creative_media`，没有素材表记录时回退到订单的 `media_file_id` 或 `media_items_json`。

Workers `scheduled` 入口会依据 `D1_SCHEMA_CONTRACT` 选择 `processProductionDuePublishTasks` 或旧开发适配器。生产配置已声明 `D1_SCHEMA_CONTRACT=production-0008`。

## 检查证据

- `pnpm cf:config:check`：通过。
- `pnpm db:check`：通过，10 份本地 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，9 个测试文件、33 个测试。
- `pnpm build`：通过。

## 尚未完成

认证、频道、媒体接收、CRM、付款和 API 路由仍有旧 schema 查询，需要继续建立统一 production adapter。Queue consumer、DLQ、Cloudflare Secrets、Worker 上传、Cron 运行验证和 Telegram 真实联调仍未执行。