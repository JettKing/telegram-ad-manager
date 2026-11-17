# TG Ad Manager V1.1 任务清单

## 阶段 1–8：代码基线

认证、RBAC、频道、媒体、CRM、订单、付款、退款、排期和发布队列代码基线已完成；本地门禁通过，真实外部联调依赖生产配置。

## 阶段 9–10：生产资源与发布 adapter

- [x] 只读审计 Cloudflare 账户、D1、Worker 和 Queue。
- [x] 完成生产发布 Cron 的 `publish_tasks`、`ad_schedules`、`ad_orders`、`creative_media` adapter。
- [x] 使用 `D1_SCHEMA_CONTRACT=production-0009` 开关，避免开发 schema 查询误用于生产。

## 阶段 11：其余 API 的生产 schema adapter

- [x] Telegram identity/session：users、tenant/workspace membership、token_hash session。
- [x] 频道绑定和权限快照：telegram_channels、telegram_channel_permissions。
- [x] CRM、套餐、订单、创意：ad_customers、ad_packages、ad_orders、ad_creatives、creative_media。
- [x] 付款提交、Finance 审核和付款流水：payment_submissions、financial_ledger_entries。
- [x] Webhook update/log 去重：telegram_updates、telegram_webhook_logs。
- [x] 对生产 schema 缺口返回稳定错误，不回退猜测旧表。
- [x] 将排期列表、任务列表和创建排期 HTTP API 切换到 production-publishing adapter。
- [x] 为媒体 source/message 幂等和相册状态补充并执行生产专用 schema migration。
- [ ] 评审并创建退款申请表 adapter。

## 阶段 12：生产排期 API 收口

- [x] 生产排期列表读取 `ad_schedules` 的 `start_at/end_at/timezone/repeat_until` 字段。
- [x] 生产任务列表读取 `publish_tasks` 的 `available_at/locked_at/completed_at/telegram_message_ids_json` 字段。
- [x] 生产创建排期要求 `endAt`，并与 Cron 使用相同的 `ProductionPublishRepository`。
- [x] 新增生产排期 adapter 测试，防止回退到 `ad_publish_tasks` 旧表。

## 阶段 13：SaaS 订阅与权益基础

- [x] 增加 FREE、PRO、BUSINESS 订阅计划和权益种子数据。
- [x] 增加租户当前订阅、权益额度和按月用量表。
- [x] 首次本地租户初始化自动获得 FREE 订阅。
- [x] 增加订阅计划、权益用量和订阅状态 API。
- [x] 增加付费升级请求和幂等键，状态保持 pending，不伪造支付成功。
- [x] 增加订阅请求参数测试。
- [ ] 将订阅表和权益计费适配到生产 D1 schema。
- [ ] 接入真实支付或 Finance 人工审核闭环。

## 阶段 14：订阅审核、续费和权益强制执行

- [x] 平台管理员白名单审核订阅升级请求。
- [x] 审核通过后切换租户订阅并写入 SaaS 财务流水和订阅事件。
- [x] 审核拒绝后保留拒绝原因和审核人。
- [x] Cron 处理 FREE 自动续费和付费订阅到期。
- [x] 订单创建强制检查并记录月度订单额度。
- [x] 频道绑定强制检查最大频道额度。
- [x] 增加审核解析和决策边界测试。
- [ ] 生产 D1 接入订阅表和平台管理员配置。
- [ ] 接入真实支付回调或人工收款审核入口。

## 生产操作边界

生产 D1 媒体 migration 已执行，Queue 已存在；Worker dry-run 已通过。仍待完成 Worker 实际上传、Secrets 写入、Cron 验证、Telegram Webhook 切换和真实 Telegram 发布联调。当前 Worker 上传受 Wrangler OAuth CAPTCHA 阻塞。
