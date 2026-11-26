# KNOWN_ISSUES

1. 生产媒体 source/message 字段和相册表已通过独立 migration 补齐，但仍需真实 Telegram 媒体/Webhook 联调验证。
2. 生产 D1 审计中没有发现已确认的退款申请表，production payments adapter 只实现付款凭证和 Finance 审核；退款接口返回 `REFUND_SCHEMA_UNAVAILABLE`。
3. 生产排期列表、任务列表和创建排期已切换到 `ProductionPublishRepository`，但生产 D1 写入、并发 claim、任务 lease 恢复仍需集成回归。
4. Worker、Queue/Cron、Secrets、Webhook 和 Telegram 真实频道发布仍需真实外部联调；当前已完成部署门禁和基础线上 smoke，不等同于完整 E2E 验收。
5. 生产 adapter 尚未完成隔离 D1 全量重建和真实写入回归；任何远程 migration 或 deploy 都必须保留只读 schema probe 和回滚记录。
6. 订阅计划和权益目前先接入本地 schema；`production-0009` contract 会明确返回 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED`，不会假设生产已有订阅表。
7. 付费升级目前只创建 pending checkout request，尚未接入真实支付网关或完整 Finance 人工审核动作。
8. 前端当前只提供订单创建、排期创建和列表展示，尚未形成付款提交、Finance 审核、退款和发布失败恢复的完整运营工作台。
9. 生产退款 API 当前稳定返回 `REFUND_SCHEMA_UNAVAILABLE`；在补齐生产退款 schema 前，不得将退款能力宣称为可运营功能。
