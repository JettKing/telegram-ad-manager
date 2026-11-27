# Production Integration — Stage 9–14 / production-0009

> 历史阶段记录：本页的账户、Worker、D1 表数及部署状态来自较早时间点，不代表当前线上状态。请以 `PROJECT_STATUS.md` 的 2026-11-27 Cloudflare 只读核验、`TODO.md` 和最近部署记录为准；本页原始历史结论保留用于追溯。

## 2026-11-27 最新生产状态

生产发布 workflow `45921992737` 成功应用 `0018_refund_disbursement.sql`；后续 workflow `45931956483` 在迁移前备份并校验 D1 后应用 `0019_multi_currency_finance.sql`，部署 Worker，并配置/验证 Telegram Bot identity。生产财务现支持 CNY、USD、TON、USDT，USDT 网络为 TON、TRON；退款批准与实际出款仍分开。前端最新提交 `fc19b5a` 的 Pages run `45932615514` 与 CI run `45932615488` 均成功。真实业务收款/退款对账仍待验收。

此前只读 HTTP smoke checks 中 `/health`、`/health/ready`、`/api/v1/health` 均返回 200。已核验部署后的 `production_cron` 快照为 `ok`（`2026-11-27T01:25:54.709Z`），结果为零任务处理、零失败。Queue 当前 0 consumer，代码无 Queue producer `.send()`/handler；发布和通知走 D1 polling + Cron。历史 Webhook logs 的 accepted/200 不构成最新部署后的送达证据。真实测试租户/频道 E2E、多币种收款/退款账务对账以及 iPhone Telegram Mini App 验收尚未完成；代码/CI、部署成功与生产业务验收必须分别报告。

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
