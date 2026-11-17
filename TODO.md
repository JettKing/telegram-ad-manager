# TG Ad Manager V1.1 任务清单

## 阶段 1–8：代码基线

认证、RBAC、频道、媒体、CRM、订单、付款、退款、排期和发布队列代码基线已完成；本地门禁通过，真实外部联调依赖生产配置。

## 阶段 9：生产资源审计与部署准备

- [x] 只读盘点 Cloudflare 账户、D1、Workers 和 Queues。
- [x] 识别生产 D1 与仓库旧 Migration 的 schema 差异。
- [x] 写入真实资源绑定的 `wrangler.production.jsonc` 和配置校验脚本。
- [ ] 在完成 schema adapter 后执行真实 D1 migration、Queue、Worker 和 Secret 变更。

## 阶段 10：生产 schema adapter

- [x] 适配生产 `publish_tasks`、`publish_task_logs` 的 available_at/locked_at/completed_at/telegram_message_ids_json 字段。
- [x] 适配生产 `ad_schedules.start_at/end_at/timezone/repeat_until` 字段，并要求生产排期具有 endAt。
- [x] 适配生产 `ad_orders.content_text/media_type/media_file_id/media_items_json` 和 `creative_media` 素材来源。
- [x] 适配 `telegram_channel_permissions.can_post_messages` 发布权限检查。
- [x] 生产成功发布保存完整 message ID 列表，失败按生产状态值写入 queued/dead_letter/uncertain。
- [x] Workers Cron 根据 `D1_SCHEMA_CONTRACT=production-0008` 选择生产发布适配器。
- [x] 增加生产排期输入、依赖未配置保护和完整本地门禁测试。
- [ ] 将 CRM、认证、频道、媒体、付款 API 全部迁移到生产 schema adapter。
- [ ] 补齐 Queue consumer、DLQ、Cloudflare Secrets 和真实 Telegram 联调。

## 生产安全边界

阶段 9–10 当前只执行了 Cloudflare 只读审计和本地代码验证，没有执行 D1 migration、Queue 创建、Worker 上传、Secret 写入或 Telegram Webhook 切换。
