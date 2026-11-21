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

截至 2026-11-21，只读核对确认生产 Worker、D1/Queue bindings、Secrets 名称和五分钟 Cron 已配置，Pages 和健康接口返回 200；这些检查不等同于真实业务验收。生产媒体字段和表存在，但 0009 不在 Wrangler 迁移账本中；禁止重放历史 SQL 或对生产库应用开发迁移。生产部署、密钥更改、Webhook 切换和数据库写入均需另行确认。

## 阶段 15：生产风险收口（进行中）

- [x] 在修复分支实现频道绑定时验证会话用户是 Telegram 频道管理员，并以原子归属条件拒绝跨工作空间覆盖；本地回归通过，尚未部署或完成真实频道验收。
- [x] 在修复分支隔离生产与开发迁移目录、归档已执行但未登记的媒体 SQL，并修复 JSONC 校验；本地及隔离 Wrangler 检查通过，尚未部署。
- [x] 在修复分支修正 Telegram Mini App 登录 HMAC 派生顺序及等价参数重放问题，加入固定向量测试；未部署或真实验收。
- [ ] 为生产缺失的 `telegram_init_data_replays` 设计可审计的迁移，在隔离 D1 验证后按确认过的上线方案处理；不得关闭防重放。评估新旧重放键滚动切换与历史已绑定频道归属。
- [ ] 解决频道主记录和权限快照非原子的故障/并发一致性问题，在隔离真实 D1 验证。
- [ ] 在隔离 D1 复核生产 schema 和迁移历史，建立可重建的生产基线，备份与恢复验证后制定生产迁移方案。
- [ ] 修复并验证订单财务状态绕过、部分付款累计和排期发布前的付款校验。
- [ ] 修复并验证订单取消或频道解绑后待发布任务仍可能发送的问题。
- [ ] 在测试频道完成管理员绑定、付款、排期、发送和失败重试的端到端验收。
- [ ] 审核、部署并监控安全修复；在未经确认前不改动生产环境。
