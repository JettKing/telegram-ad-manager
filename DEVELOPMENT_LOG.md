# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 10 生产 schema adapter

基于 Cloudflare D1 只读审计结果，新增 `production-publishing.ts`。适配生产 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`ad_orders`、`creative_media` 和 `telegram_channel_permissions`，不再把本地 `ad_publish_tasks` 契约直接部署到生产。

生产 Worker Cron 通过 `D1_SCHEMA_CONTRACT=production-0008` 选择适配器。生产排期要求 endAt，发布成功保存完整 Telegram message ID 列表，重试和死信状态映射到生产表允许的状态值。

阶段门禁通过：33 个测试、10 份本地 Migration、生产配置校验、类型、Lint 和构建。仍未执行任何 Cloudflare 写操作。

## 2026-11-17 — 阶段 9 生产资源审计

确认目标 D1、Queue、Worker 资源和 schema 差异，写入生产 Wrangler 配置与 preflight。
