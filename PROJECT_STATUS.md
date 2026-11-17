# PROJECT_STATUS

## 当前状态

阶段 7 已完成付款凭证、Finance 审核和退款流水的代码基线，并通过本地门禁。付款凭证不伪造本地文件上传，而是引用既有 Telegram 媒体素材；真实文件下载、R2 存储和上传通道保留给后续基础设施阶段。

## 已实现

`apps/api/src/payments.ts` 提供付款和退款输入校验、D1 查询、金额累计、审核状态更新和订单状态同步。提交付款凭证前校验订单仍处于待付款/待审核状态、凭证素材属于当前 Tenant/Workspace 且为 ready、付款金额为正整数且不超过未核销应收。

Finance 可读取待审核付款和退款队列。付款审核会保存审核人、审核时间、备注、付款状态和 `paid_at`；当 approved 付款累计达到订单应收时，订单同步为 `payment_status = paid`，可迁移的订单同步为 `status = paid`。拒绝会保留拒绝记录和备注，不删除凭证。

退款使用独立的 `ad_order_refunds` 流水表。申请时要求正金额和理由；可退款金额等于订单应收减去已批准退款，拒绝超额。Finance 批准后按累计批准退款同步 `refunded` 或 `partially_refunded`，每次申请和审核都写入订单修订记录。

## API

付款：`GET /api/v1/finance/payments/pending`、`GET/POST /api/v1/orders/:orderId/payments`、`POST /api/v1/finance/payments/:paymentId/review`。退款：`GET /api/v1/finance/refunds/pending`、`GET/POST /api/v1/orders/:orderId/refunds`、`POST /api/v1/finance/refunds/:refundId/review`。

付款提交使用 `order:write`；付款/退款审核和待审核队列使用 `finance:read`/`finance:write`。所有查询通过订单 Tenant/Workspace 条件隔离。

## 检查证据

- `pnpm db:check`：通过，9 份 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：阶段测试补充后共 26 个测试。
- `pnpm build`：通过。

## 尚未完成

尚未执行真实 Cloudflare D1 Migration、事务并发、R2 文件上传、支付渠道回调、生产财务对账和财务审计流水。当前实现是内部付款凭证和退款审核状态机，不代表已接入真实支付网关。
