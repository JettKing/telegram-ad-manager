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

- [x] CRM、广告套餐、订单、编辑器、订单修订和素材引用。
- [x] 订单创建前验证客户、套餐、active 频道和 ready 素材的 Tenant/Workspace 归属。
- [ ] 真实 D1 事务、订单审批 UI、排期与发布队列联调。

## 阶段 7：付款凭证、Finance 审核与退款流水（已完成代码基线，D1 远端执行待配置）

- [x] 付款凭证引用、Finance 审核、付款状态同步、退款申请和退款审核。
- [ ] 真实 D1 事务、支付渠道回调、文件上传/R2、生产财务对账和审计日志联调。

## 阶段 8：排期、Telegram 发布队列与到期处理（已完成代码基线，外部 Telegram/D1 联调待配置）

- [x] 排期类型和 plannedAt/plannedEndAt 校验，只有 approved 订单可以入排期。
- [x] 创建排期时写入唯一发布任务，任务使用 `schedule:<scheduleId>` 幂等键。
- [x] 队列 claim 使用 queued → processing 条件更新，避免同一任务被重复 claim。
- [x] Telegram 发布支持 text、photo、video、document/animation，并保存成功 message_id。
- [x] Telegram 429 使用 retry_after；网络/服务错误使用指数退避并受 max_attempts 限制。
- [x] 发布成功同步订单为 published；失败最终状态为 failed/uncertain。
- [x] Cron scheduled handler 执行到期任务，按 planned_end_at 删除已发布消息并同步 completed。
- [ ] 真实 Cloudflare D1/Workers Cron、Telegram Bot 权限、Queues 和多消息/多媒体外部联调。

## 后续阶段（未开始）

- [ ] SaaS 订阅、财务统计、管理员后台、运营仪表盘和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。未配置的外部验收项保持未完成。
