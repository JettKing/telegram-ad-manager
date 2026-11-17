# PROJECT_STATUS

## 当前状态

阶段 9 已开始，完成了真实 Cloudflare 资源的只读审计和部署前安全准备。当前没有执行任何生产写入或公开发布。

## Cloudflare 资源审计

唯一授权账户：`bf9869d76a7fcbd9f75aefc5f98f3fbb`。

目标 D1：`tg-ad-manager`，ID `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`。目标 Queue：`tg-ad-manager-publish`，ID `9fc8423242564c1e814108cdf5883208`。目标账户尚无 `tg-ad-manager-api` Worker，Queue 当前无 producer/consumer。

D1 不是空 schema：已有 `schema_migrations` 0001–0008 和生产表 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`ad_creatives`、`creative_media`、`payment_submissions`。当前关键业务表行数为 0。

## 关键阻塞

生产 D1 与当前仓库 Migration/代码不是同一 schema：生产发布表使用 `publish_tasks`，而仓库发布器使用 `ad_publish_tasks`；生产素材使用 `creative_media`，而仓库使用 `media_assets`；生产支付使用 `payment_submissions`，而仓库使用 `ad_order_payments`。生产排期使用 `start_at/end_at/timezone`，而仓库使用 `planned_at`。直接部署会造成 SQL 失败，不能以“业务数据为 0”作为跳过适配的理由。

## 已完成准备

新增 `wrangler.production.jsonc`，绑定真实 D1、Queue、账户和 5 分钟 Cron；新增 `pnpm cf:config:check`；新增 `PRODUCTION_INTEGRATION.md` 记录审计证据、部署顺序和阻塞项。没有写入 Token、Secret 或私密凭据。

## 下一步

先实现 production schema adapter 和 Queue consumer，再在明确确认后执行真实 D1 迁移、DLQ 创建、Worker 上传、Secret 写入、Cron 验证和 Telegram Webhook/频道/发布联调。