# KNOWN_ISSUES

1. 生产 `creative_media` 没有 Telegram source message/chat 幂等字段，因此 production media adapter 只提供读取；Webhook 媒体入库会返回 `MEDIA_SOURCE_SCHEMA_REQUIRED`。
2. 生产 D1 审计中没有发现已确认的退款申请表，production payments adapter 只实现付款凭证和 Finance 审核；退款接口返回 `REFUND_SCHEMA_UNAVAILABLE`。
3. `/api/v1/schedules` 和创建排期接口仍实例化旧 `D1PublishRepository`，需要下一步复用 `production-publishing.ts` 的 HTTP 查询和创建实现。
4. Cloudflare Worker、Queue consumer/DLQ、Secrets、Webhook URL 和 Telegram 真实联调尚未执行；当前只完成只读资源审计和本地代码门禁。
5. 生产 adapter 尚未经过真实 D1 写入回归；任何远程 migration 或 deploy 都必须在独立确认后执行。
6. 订阅计划和权益目前先接入本地 schema；`production-0008` contract 会明确返回 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED`，不会假设生产已有订阅表。
7. 付费升级目前只创建 pending checkout request，尚未接入真实支付网关或 Finance 人工审核动作。
