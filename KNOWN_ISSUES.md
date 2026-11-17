# KNOWN_ISSUES

1. 当前 Cloudflare D1 `tg-ad-manager` 已存在独立 production schema 0001–0008，和仓库阶段 1–8 的 Migration/代码契约不一致。禁止直接执行本地后续 Migration 或上传当前 Worker，必须先做 schema adapter。
2. 生产使用 `publish_tasks`/`publish_task_logs`、`creative_media`、`payment_submissions` 和生产版 `ad_schedules`；仓库代码仍使用 `ad_publish_tasks`/`ad_publish_logs`、`media_assets`、`ad_order_payments` 和 `planned_at`。
3. 目标账户当前没有 `tg-ad-manager-api` Worker，队列 `tg-ad-manager-publish` 没有 producer/consumer，DLQ 也尚未创建。
4. Telegram Token、Webhook Secret、Session Secret 和 Bot identity 尚未写入 Cloudflare Secrets，无法进行真实 Telegram 联调。
5. 阶段 9 当前只完成只读审计和本地生产配置校验，没有执行 D1 migration、Queue 创建、Worker 上传、Secret 写入或 Telegram Webhook 切换。
6. 真实 schema 适配完成后仍需验证 D1 并发 claim、Queue 重试/DLQ、Cron、Telegram 429、消息删除和跨租户隔离。
