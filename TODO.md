# TG Ad Manager V1.1 任务清单

## 阶段 1：工程基础（已完成基线，D1 远端执行待配置）

- [x] 初始化项目、TypeScript、Vite、Hono、共享契约和文档基线。
- [x] 建立 D1/SQLite Migration 目录、健康探针和响应式工作台。
- [ ] 执行目标 Cloudflare D1 远端 Migration 并保留结果证据。

## 阶段 2：Telegram Bot 交互与认证集成（已完成代码基线，外部联调待配置）

- [x] Mini App `initData` HMAC-SHA256 验签、auth_date 新鲜度和 replay 防护。
- [x] Telegram Webhook Secret、Update 解析和去重。
- [ ] 配置真实 Token、Webhook Secret、公开 HTTPS URL 后执行外部联调。

## 阶段 3：用户、平台会话与 RBAC（已完成代码基线，D1 远端执行待配置）

- [x] 用户 upsert、默认 Tenant/Workspace、Owner 成员关系。
- [x] 可撤销 HMAC Bearer Session 和后端 RBAC middleware。
- [ ] 租户切换、成员邀请、角色变更、审计日志和资源级权限。

## 阶段 4：频道绑定与 Telegram 权限检查（已完成代码基线，外部联调待配置）

- [x] Bot API 频道身份、管理员状态和发布/编辑/删除权限检查。
- [x] 频道列表、绑定、复核、软解绑 API，并按 Tenant/Workspace 隔离。
- [ ] 配置真实 Bot Token、D1、Bot identity 和测试频道执行外部联调。

## 阶段 5：多媒体素材与相册聚合（已完成代码基线，外部联调待配置）

- [x] Webhook 解析 text、photo、video、animation/GIF、document 和 `channel_post`。
- [x] 保存 Telegram 文件元数据并使用来源消息幂等键。
- [x] 相册 `collecting → settling → pending_confirmation → completed` 状态机和迟到消息版本重开。
- [ ] 配置真实 D1、Webhook 和测试消息，验证 Telegram 多媒体外部联调。

## 阶段 6：CRM、套餐、订单和编辑器（已完成代码基线，D1 远端执行待配置）

- [x] CRM 客户、广告套餐、订单、编辑器、订单修订和素材引用。
- [x] 订单创建前验证客户、套餐、active 频道和 ready 素材的 Tenant/Workspace 归属。
- [ ] 真实 D1 事务、订单审批 UI、排期与发布队列联调。

## 阶段 7：付款凭证、Finance 审核与退款流水（已完成代码基线，D1 远端执行待配置）

- [x] 使用媒体素材作为付款凭证引用，提交付款方式、金额、交易号和凭证素材。
- [x] 付款金额按订单应收和已提交/已审核金额累计校验，阻止超额付款。
- [x] Finance 待审核付款队列，支持 approved/rejected、审核人、时间和备注。
- [x] 审核通过后按累计审核金额同步订单 `payment_status`，全额支付时同步订单为 paid。
- [x] 退款申请和独立退款流水，支持部分退款、退款理由、退款方式和交易号。
- [x] Finance 退款审核，按已批准退款累计金额阻止超额退款并同步 refunded/partially_refunded。
- [ ] 真实 D1 事务、支付渠道回调、文件上传/R2、生产财务对账和审计日志联调。

## 后续阶段（未开始）

- [ ] 排期与发布、到期处理、SaaS 订阅、财务统计、管理员后台和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。未配置的外部验收项保持未完成。
