# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。所有受保护接口从 Bearer Session 解析 Tenant/Workspace，不接受客户端传入的 tenant_id 来扩大查询范围。

## 阶段 7 付款与退款

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/v1/finance/payments/pending` | `finance:read` | Finance 待审核付款队列 |
| GET | `/api/v1/orders/:orderId/payments` | `order:read` | 当前工作空间订单付款记录 |
| POST | `/api/v1/orders/:orderId/payments` | `order:write` | 提交付款方式、金额、交易号和 `proofAssetId` |
| POST | `/api/v1/finance/payments/:paymentId/review` | `finance:write` | 审核付款，`approved` 或 `rejected` |
| GET | `/api/v1/finance/refunds/pending` | `finance:read` | Finance 待审核退款队列 |
| GET | `/api/v1/orders/:orderId/refunds` | `order:read` | 当前工作空间退款流水 |
| POST | `/api/v1/orders/:orderId/refunds` | `order:write` | 创建退款申请 |
| POST | `/api/v1/finance/refunds/:refundId/review` | `finance:write` | 审核退款，`approved` 或 `rejected` |

付款提交结构为 `{ method, amountMinor, transactionRef?, proofAssetId? }`。`proofAssetId` 必须是当前工作空间 ready 的 photo、document 或 animation 素材；阶段 7 不直接声称完成文件上传或 R2 存储。服务端会累计当前订单 pending_review/approved 付款，阻止付款总额超过 receivable。

付款审核保存 `reviewed_by`、`reviewed_at`、`review_note` 和 `paid_at`。全部 approved 金额达到订单应收时，订单 `payment_status` 变为 `paid`，并在允许的状态路径中进入 `paid`。

退款申请结构为 `{ amountMinor, reason, method?, transactionRef? }`。服务端按订单应收减去已批准退款计算可退款上限。Finance 批准后同步 `payment_status` 为 `partially_refunded` 或 `refunded`，并记录审核人、审核时间、备注和订单修订。

## 既有接口

CRM：`GET/POST/PATCH /api/v1/customers`。套餐：`GET/POST/PATCH /api/v1/packages`。订单：`GET/POST /api/v1/orders`、`GET /api/v1/orders/:orderId`、`PATCH /api/v1/orders/:orderId/content`、`POST /api/v1/orders/:orderId/submit`、`POST /api/v1/orders/:orderId/transition`。频道、媒体、Telegram auth 和 Webhook 仍按前置阶段契约提供。
