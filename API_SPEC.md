# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。所有受保护接口从 Bearer Session 解析 Tenant/Workspace，不接受客户端传入的 tenant_id 来扩大查询范围。

## 阶段 8 排期与发布队列

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/v1/schedules` | `publish:read` | 当前工作空间排期列表 |
| GET | `/api/v1/publish-tasks` | `publish:read` | 当前工作空间发布任务和重试状态 |
| POST | `/api/v1/orders/:orderId/schedules` | `publish:write` | 校验 approved 订单、active 频道后创建排期和幂等发布任务 |

创建排期结构为 `{ scheduleType, plannedAt, plannedEndAt? }`。`scheduleType` 支持 `once`、`daily`、`weekly`、`custom`；`plannedAt` 不能过期，`plannedEndAt` 必须晚于计划发布时间。只有 approved 订单可以入排期。

发布任务使用 `schedule:<scheduleId>` 作为唯一幂等键。Workers scheduled handler 通过 D1 条件更新 claim queued 任务，最多处理 10 个任务。任务成功记录 Telegram `message_id` 并同步订单为 published；429 使用 `retry_after`，网络错误采用指数退避，达到 max_attempts 后记录 failed/uncertain。

到期处理查找 published 且 `planned_end_at <= now` 的订单，调用 `deleteMessage`。成功后订单为 completed，并写入 `ad_publish_logs`。实际 Cron、真实 Telegram 和 Cloudflare D1/Queues 仍需外部联调。

## 阶段 7 付款与退款

付款、Finance 审核和退款接口继续由 `finance:read`、`finance:write`、`order:read`、`order:write` 保护。

## 既有接口

CRM：`GET/POST/PATCH /api/v1/customers`。套餐：`GET/POST/PATCH /api/v1/packages`。订单：`GET/POST /api/v1/orders`、`GET /api/v1/orders/:orderId`、`PATCH /api/v1/orders/:orderId/content`、`POST /api/v1/orders/:orderId/submit`、`POST /api/v1/orders/:orderId/transition`。频道、媒体、付款、Telegram auth 和 Webhook 仍按前置阶段契约提供。
