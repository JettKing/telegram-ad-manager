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
- [x] 可撤销 HMAC Bearer Session 和 Owner/Admin/Manager/Editor/Finance/Viewer RBAC middleware。
- [ ] 租户切换、成员邀请、角色变更、审计日志和资源级权限。

## 阶段 4：频道绑定与 Telegram 权限检查（已完成代码基线，外部联调待配置）

- [x] Bot API client 支持 `getMe`、`getChat`、`getChatMember`，不把 Token 放入请求体或日志。
- [x] 校验目标 `Chat.type === "channel"`，识别 Bot creator/administrator/member 状态。
- [x] 保存 `can_post_messages`、`can_edit_messages`、`can_delete_messages` 权限快照。
- [x] 缺少发布权限时保存 `permission_error`，不伪装为可发布频道。
- [x] 提供频道列表、绑定、复核和软解绑 API，并按 Tenant/Workspace 隔离。
- [ ] 配置真实 Bot Token、D1、Bot identity 和测试频道管理员权限，执行 Telegram 外部联调。

## 后续阶段（未开始）

- [ ] 多媒体素材状态机、CRM、套餐、订单、编辑器、排期、队列发布、到期处理、订阅、财务统计、管理员后台和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。未配置的外部验收项保持未完成。
