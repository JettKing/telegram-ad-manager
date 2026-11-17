# TG Ad Manager V1.1 任务清单

## 阶段 1：工程基础（已完成基线，D1 远端执行待配置）

- [x] 初始化项目目录、TypeScript、Vite、Hono、共享契约和文档基线。
- [x] 建立 Cloudflare D1/SQLite 兼容 Migration 目录。
- [ ] 完成真实数据库迁移执行器并在目标 D1 上验证。
- [x] 建立健康和就绪探针。
- [x] 提供响应式 Mini App / Web 后台壳层与路由清单。

## 阶段 2：Telegram Bot 交互与认证集成（已完成代码基线，外部联调待配置）

- [x] 实现 Mini App `initData` HMAC-SHA256 验签、auth_date 新鲜度和 replay 防护。
- [x] 实现 `POST /api/v1/auth/telegram` 的签名校验入口。
- [x] 实现 `POST /webhooks/telegram` 的 Secret Token 校验、Update 解析和去重。
- [ ] 配置真实 Token、Webhook Secret、公开 HTTPS URL 后执行 Telegram 外部联调。

## 阶段 3：用户、平台会话与 RBAC（已完成代码基线，D1 远端执行待配置）

- [x] Telegram 身份成功后幂等 upsert `users`，更新 username/display_name，不重复创建用户。
- [x] 首次登录创建默认 Tenant、Workspace、Owner tenant member 和 workspace member；已有成员复用最早的 active tenant/workspace。
- [x] 创建随机 session id，数据库保存会话状态，返回 HMAC 签名 Bearer Token。
- [x] `GET /api/v1/auth/me` 验证签名、数据库状态、租户成员、工作空间成员和 expires_at。
- [x] `POST /api/v1/auth/logout` 写入 revoked_at，撤销后 Token 立即失效。
- [x] 实现 Owner/Admin/Manager/Editor/Finance/Viewer 权限矩阵和后端 middleware。
- [x] `GET /api/v1/workspace/context` 受 `workspace:read` 保护；`GET /api/v1/finance/access` 受 `finance:read` 保护，越权返回 403。
- [ ] 增加租户切换、邀请成员、角色变更、审计日志和真正业务资源级权限。

## 阶段 4：频道绑定与权限检查（未开始）

- [ ] 真实检查频道身份、发布/置顶/删除权限，支持多频道绑定、取消绑定和重新验证。

## 阶段 5：多媒体与业务模块（未开始）

- [ ] 实现媒体状态机、CRM、套餐、订单、付款核账、编辑器、排期、真实发布、到期处理、SaaS 订阅、财务统计、管理员后台和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。任何未配置的外部验收项保持未完成。
