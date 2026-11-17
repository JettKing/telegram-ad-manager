# DEVELOPMENT_LOG

## 2026-11-18 — 阶段 14 订阅审核与权益执行

增加平台管理员白名单审核订阅升级请求；审核通过后关闭旧订阅、创建新订阅，并写入 `subscription_events` 与 `financial_transactions`。Workers Cron 现在处理 FREE 自动续费和付费订阅到期。订单创建记录月度订单用量，频道绑定检查最大频道额度。付费确认不会由客户端直接触发，生产 contract 仍明确跳过尚未审计的订阅表。

## 2026-11-18 — 阶段 13 SaaS 订阅与权益基础

新增 Migration 0011、`subscription.ts` 和订阅 API。计划包含 FREE、PRO、BUSINESS 三档，租户首次本地初始化自动获得 FREE 订阅；权益额度和月度用量通过 D1 记录，付费升级请求使用幂等键并保持 pending，避免没有支付网关时虚构成功。当前订阅表尚未切换到生产 D1 contract。

## 2026-11-18 — 阶段 12 生产排期 API 收口

为 `ProductionPublishRepository` 增加生产排期和发布任务列表查询，并将 `/api/v1/schedules`、`/api/v1/publish-tasks` 和创建排期接口在 `production-0008` contract 下切换到生产 adapter。生产 HTTP API 与 Workers Cron 现在共享 `ad_schedules`、`publish_tasks` 的字段契约。新增测试后，测试总数为 34 个并全部通过。

## 2026-11-18 — 阶段 11 其余 API 的 production schema adapter

读取并审计生产 D1 的 identity、membership、channel、CRM、package、order、payment、ledger、creative 和 webhook 表字段。新增 `production-identity.ts`、`production-channels.ts`、`production-business.ts`、`production-payments.ts` 和 `production-media.ts`；API 在 `production-0008` contract 下按领域选择适配器。

新增 `ProductionD1WebhookUpdateStore`，使用生产 `telegram_updates`/`telegram_webhook_logs` 字段，保持 update_id 原子去重。对生产缺少 source 幂等字段的媒体写入、缺少退款表的退款流程返回明确稳定错误，避免旧 schema 猜测写入。

本地门禁结果：`cf:config:check`、`db:check`、`typecheck`、`lint`、`test` 33/33、`build` 全部通过。没有执行 Cloudflare 生产写入。

## 2026-11-17 — 阶段 10 生产 schema adapter

新增 `production-publishing.ts`，适配生产排期、发布任务、素材和频道权限；Workers Cron 通过 `D1_SCHEMA_CONTRACT=production-0008` 选择适配器。
