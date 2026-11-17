# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 7 付款凭证、Finance 审核与退款流水

新增 `apps/api/src/payments.ts` 和 `0009_payments_refunds.sql`。付款凭证以已入库 media asset 作为 proofAssetId，提交时验证订单范围、素材范围、状态和未核销应收金额。Finance 审核记录审核人、时间、备注和 paid_at，并在全额核销后同步订单 payment_status/status。

新增独立 `ad_order_refunds` 退款流水，支持申请理由、退款方式、交易号、待审核、通过和拒绝。退款金额以已批准退款累计值作为上限，Finance 批准后同步 partially_refunded/refunded，并写订单修订记录。新增付款和退款队列接口，权限分离为 order:write 与 finance:read/write。

阶段测试新增后共 26 个通过测试；9 份 Migration、类型、Lint 和生产构建通过。真实 D1、R2、支付网关回调和财务生产对账仍未联调。

## 2026-11-17 — 阶段 6 CRM、套餐、订单与编辑器

实现客户、套餐、订单、内容编辑器和素材引用。

## 2026-11-17 — 阶段 5 多媒体素材与相册聚合

实现媒体解析、素材幂等和相册状态机。
