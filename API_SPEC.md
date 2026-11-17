# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。服务通过 `x-request-id` 传递追踪标识，不在日志中写入 Bot Token、Webhook Secret、付款凭证原文或完整 initData。

## 当前已实现

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/health` | 进程存活探针 | 已实现 |
| GET | `/health/ready` | 必要依赖就绪探针；数据库未配置时返回 503 | 已实现 |
| GET | `/api/v1/health` | 统一响应的运行状态 | 已实现 |
| GET | `/api/v1/metadata` | 产品版本和外部集成配置状态 | 已实现 |
| POST | `/api/v1/auth/telegram` | 验证原始 Mini App initData；可使用 JSON `initData` 或 `X-Telegram-Init-Data` 头 | 已实现 |
| POST | `/webhooks/telegram` | 验证 Webhook Secret、解析 Update、按 `update_id` 去重并持久化最小记录 | 已实现 |

## Telegram 身份认证

`POST /api/v1/auth/telegram` 接收 `{ "initData": "<raw Telegram.WebApp.initData>" }`。服务端必须配置 `TELEGRAM_BOT_TOKEN`。校验失败会返回 401；未配置 Bot Token 或 replay store 不可用返回 503。成功响应只在 HMAC、`auth_date` 和 replay 检查通过后返回解析出的 Telegram 用户资料。当前阶段还没有将用户 upsert 到 `users` 或签发持久会话；这属于下一步多租户会话模块，不能把验证通过误称为完整登录闭环。

## Telegram Webhook

`POST /webhooks/telegram` 必须携带 `X-Telegram-Bot-Api-Secret-Token`。服务端配置 `TELEGRAM_WEBHOOK_SECRET` 后，先校验 Secret，再解析包含非负整数 `update_id` 的 JSON。若存在 `DB` binding 和 `TELEGRAM_BOT_IDENTITY_ID`，会写入 `telegram_updates` 和 `telegram_webhook_logs`；没有 D1 binding 的开发环境使用进程内去重存储，仅用于本地测试，不代表生产持久化。

## 后续接口边界

租户/工作空间/频道、CRM、套餐、订单、素材、排期、发布任务、订阅、统计和管理员接口按需求书中的 `/api/v1` 结构逐步实现。每个写接口必须有输入校验、租户上下文、角色权限、状态转换规则和审计记录；建议路由存在不等于业务已实现。
