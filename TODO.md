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

- [x] Bot API `getMe`、`getChat`、`getChatMember`，频道身份和管理员权限检查。
- [x] 保存发布、编辑/置顶、删除权限快照；权限不足保存 `permission_error`。
- [x] 频道列表、绑定、复核、软解绑 API，并按 Tenant/Workspace 隔离。
- [ ] 配置真实 Bot Token、D1、Bot identity 和测试频道执行外部联调。

## 阶段 5：多媒体素材与相册聚合（已完成代码基线，外部联调待配置）

- [x] Webhook 解析 text、photo、video、animation/GIF、document 和 `channel_post`。
- [x] 保存 `file_id`、`file_unique_id`、文件名、MIME、大小、宽高、时长、caption、来源 chat/message。
- [x] 使用来源消息幂等键防止重复 Webhook 创建重复素材。
- [x] 相册使用 `media_group_id` 聚合，并支持 `collecting → settling → pending_confirmation → completed`。
- [x] 迟到相册消息重新打开 collecting 并递增版本；Tenant/Workspace 冲突拒绝覆盖。
- [x] 提供素材列表和相册 settle、pending-confirmation、confirm API，新增 `media:read`/`media:write` 权限。
- [ ] 配置真实 D1、Webhook 和测试消息，验证 Telegram 多媒体外部联调。

## 后续阶段（未开始）

- [ ] CRM、套餐、订单、付款核账、编辑器、排期、队列发布、到期处理、订阅、财务统计、管理员后台和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。未配置的外部验收项保持未完成。
