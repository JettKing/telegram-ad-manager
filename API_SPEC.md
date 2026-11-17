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

## 后续接口边界

身份接口将提供 `POST /auth/telegram`、`GET /auth/me`、`POST /auth/logout`；租户/工作空间/频道、CRM、套餐、订单、素材、排期、发布任务、订阅、统计和管理员接口按需求书中的 `/api/v1` 结构逐步实现。每个写接口必须有输入校验、租户上下文、角色权限、状态转换规则和审计记录；建议路由存在不等于业务已实现。

Webhook 入口计划为 `POST /webhooks/telegram`，先验证 Secret Token 和 update_id 去重，再持久化最小 Update 并转队列。真实 Bot API 调用、队列消费者和 D1 binding 配置属于后续阶段，当前不返回模拟发布成功。
