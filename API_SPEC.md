# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。所有受保护接口从 Bearer Session 解析 Tenant/Workspace，不接受客户端传入的 tenant_id 来扩大查询范围。

## Production schema contract

当 `D1_SCHEMA_CONTRACT=production-0008` 时，路由使用 production adapter：

| 领域 | 生产表 | 状态 |
|---|---|---|
| Telegram 登录/会话 | `users`、`tenant_members`、`workspace_members`、`user_sessions` | 已接入 |
| 频道 | `telegram_channels`、`telegram_channel_permissions` | 已接入 |
| CRM/套餐/订单 | `ad_customers`、`ad_packages`、`ad_orders`、`ad_creatives`、`creative_media` | 已接入 |
| 付款/流水 | `payment_submissions`、`financial_ledger_entries` | 已接入 |
| Webhook 去重 | `telegram_updates`、`telegram_webhook_logs` | 已接入 |
| 排期发布 Cron | `ad_schedules`、`publish_tasks`、`publish_task_logs` | 阶段 10 已接入 |

生产缺口会返回稳定错误码而不是回退到旧表：`MEDIA_SOURCE_SCHEMA_REQUIRED`、`MEDIA_GROUP_SCHEMA_REQUIRED`、`REFUND_SCHEMA_UNAVAILABLE`。

## 既有接口

CRM：`GET/POST/PATCH /api/v1/customers`。套餐：`GET/POST/PATCH /api/v1/packages`。订单：`GET/POST /api/v1/orders`、`GET /api/v1/orders/:orderId`、`PATCH /api/v1/orders/:orderId/content`、`POST /api/v1/orders/:orderId/submit`、`POST /api/v1/orders/:orderId/transition`。付款：`GET/POST /api/v1/orders/:orderId/payments`、`POST /api/v1/finance/payments/:paymentId/review`。频道、媒体、排期、Telegram auth 和 Webhook 仍按前置阶段契约提供，并受 RBAC 与工作空间隔离保护。

生产退款 API 在退款表完成 schema 评审前返回 `REFUND_SCHEMA_UNAVAILABLE`。

## 阶段 13 SaaS 订阅

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/v1/subscription/plans` | `workspace:read` | 返回当前启用的订阅计划 |
| GET | `/api/v1/subscription` | `workspace:read` | 返回租户当前订阅、权益上限和当前周期用量 |
| POST | `/api/v1/subscription/checkout` | `settings:write` | 创建付费升级请求，要求 `planCode`、`billingPeriod` 和幂等 `idempotencyKey` |

免费计划会在本地租户首次初始化时自动创建。付费升级请求只进入 `pending`，没有支付网关或 Finance 审核结果时不会把订阅标记为 paid/active。当前 production contract 尚未接入订阅表，相关接口返回 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED`。

阶段 14 增加 `POST /api/v1/admin/subscriptions/:requestId/review`。请求体为 `{ decision: "approved" | "rejected", note?: string }`，必须使用 Bearer Session，并且会额外检查 `PLATFORM_ADMIN_TELEGRAM_IDS` 白名单。approved 会创建新订阅、记录 SaaS 收入流水和订阅事件；rejected 会保留审核人及原因。Workers Cron 会自动续费 FREE 订阅，并将付费订阅到期标记为 expired。
