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

- [x] CRM 客户创建、列表、编辑，支持名称、联系方式、Telegram 账号、来源、备注和客户状态。
- [x] 广告套餐创建和列表，支持广告类型、发布次数、展示/置顶/间隔、价格、折扣、自动处理策略和启用/公开字段。
- [x] 订单创建前重新验证客户、套餐、频道和素材都属于当前 Tenant/Workspace。
- [x] 订单金额从套餐价计算，折扣做非负和不超过金额校验；不信任客户端传入总额。
- [x] 订单状态显式迁移、订单提交、内容编辑、素材引用和订单修订记录。
- [x] `customer:read/write`、`order:read/write` 后端权限继续保护 CRM/套餐/订单 API。
- [ ] 真实 D1 事务、付款核账、审计日志、订单审批 UI、排期与发布队列联调。

## 后续阶段（未开始）

- [ ] 付款凭证审核、排期与发布、到期处理、SaaS 订阅、财务统计、管理员后台和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。未配置的外部验收项保持未完成。
