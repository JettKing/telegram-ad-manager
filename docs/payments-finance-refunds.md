# 付款、Finance 审核与退款

阶段 7 复用 `ad_order_payments` 作为付款记录表，并新增 `ad_order_refunds` 作为退款流水。付款凭证通过 `proof_asset_id` 引用当前工作空间中 ready 的 photo、document 或 animation 素材；这保持了媒体、权限和租户隔离，也明确区分了“引用已入库素材”和“完成文件上传/R2 存储”。

付款提交时会检查订单状态、凭证素材归属和可核销金额。当前订单所有 `pending_review` 与 `approved` 付款累计不能超过 `receivable_minor`。Finance 审核通过后重新累计 approved 付款，达到应收才把订单标记为 paid；拒绝记录保留并写入审核备注。

退款申请要求正整数金额和理由，服务端以订单应收减去已批准退款作为上限。Finance 审核通过后按累计退款金额更新 `partially_refunded` 或 `refunded`，拒绝不会扣减可退款额度。付款提交、付款审核、退款申请和退款审核均写入订单修订记录。

真实支付网关回调、R2 上传、生产对账、外部交易号幂等和 D1 并发事务仍待后续阶段联调。
