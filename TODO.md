# TG Ad Manager V1.1 任务清单

## 阶段 1：工程基础（已完成基线，D1 远端执行待配置）

- [x] 初始化项目目录、TypeScript、Vite、Hono、共享契约和文档基线。
- [x] 建立 Cloudflare D1/SQLite 兼容 Migration 目录。
- [ ] 完成真实数据库迁移执行器并在目标 D1 上验证。
  - 条件：需要目标 Cloudflare D1 绑定和迁移执行权限；不得把静态 SQL 文件存在误称为已执行。
- [x] 建立健康和就绪探针。
- [x] 提供响应式 Mini App / Web 后台壳层与路由清单。

## 阶段 2：Telegram Bot 交互与认证集成（进行中）

- [x] 实现 Mini App `initData` 后端 HMAC-SHA256 验签：按字段排序构造 data-check-string，使用 `HMAC-SHA256(bot_token, "WebAppData")` 派生密钥，校验 `hash`，检查 `auth_date` 和未来时间偏移。
- [x] 拒绝缺少 Token、缺少 hash/user、过期数据、伪造签名，并且只在签名通过后读取 Telegram 用户资料。
- [x] 增加 replay key 与 D1 持久化接口；检测重复 raw initData，D1 不可用时 fail closed，不声称完成生产登录。
- [x] 实现 `POST /api/v1/auth/telegram`，支持 JSON `initData` 或请求头传入原始 initData。
- [x] 实现 `POST /webhooks/telegram`，验证 `X-Telegram-Bot-Api-Secret-Token`、解析 `update_id`、D1/内存去重和结构化错误响应。
- [ ] 将认证用户 upsert 到 users，创建 platform session，并绑定默认 Tenant/Workspace。
- [ ] 将 Webhook Update 入队，处理消息、媒体、频道事件并写入完整处理状态。
- [ ] 配置真实 Token、Webhook Secret、公开 HTTPS URL 后执行 Telegram 外部联调；未配置前保持未验证。

## 阶段 3：频道绑定与权限检查（未开始）

- [ ] 真实检查频道身份、发布/置顶/删除权限，支持多频道绑定、取消绑定和重新验证。

## 阶段 4：多媒体素材系统（未开始）

- [ ] 支持文本、图片、视频、相册、GIF/Animation、Document 和合法组合。
- [ ] 记录 `file_id`、`file_unique_id`、媒体元数据、`media_group_id`、Bot 身份和租户归属。
- [ ] 用 collecting → settling → pending_confirmation → completed 状态机处理相册，允许迟到消息重新打开聚合。

## 阶段 5–12：业务、发布、订阅、财务与交付（未开始）

- [ ] 完成 CRM、套餐、订单、付款核账、编辑器、排期、真实发布、到期处理、SaaS 订阅、财务统计、管理员后台和最终交付。

## 真实验收边界

凡依赖 Telegram Token、频道管理员权限、Cloudflare D1/Queues/R2 的项目，必须分开记录本地模拟测试、单元测试、集成测试和真实外部服务测试。任何未配置的外部验收项保持未完成。
