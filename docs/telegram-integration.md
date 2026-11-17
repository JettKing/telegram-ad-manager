# Telegram 集成依据与实现说明

本阶段实现依据 Telegram 官方文档：Mini App 的 `initData` 必须在服务端验证，不能信任 `initDataUnsafe`；HMAC 校验使用按字母排序的全部字段构造 `data_check_string`，仅排除 `hash`，用 `HMAC-SHA256(bot_token, "WebAppData")` 派生密钥，再校验 `hash`，同时检查 `auth_date` 的新鲜度。官方文档将 `signature` 描述为第三方 Ed25519 校验字段，因此第三方校验另有排除 `hash` 和 `signature` 的数据构造规则；本项目当前是 Bot Token HMAC 路径。

Webhook 由 `setWebhook` 的 `secret_token` 配置，Telegram 会在请求中发送 `X-Telegram-Bot-Api-Secret-Token`；Telegram 在收到非 2xx 时会重试，因此服务端先校验、去重和持久化最小 Update，再交给后续异步处理。

当前代码对应关系如下：

- `packages/telegram/src/index.ts`：原始字符串解析、排序、HMAC-SHA256、常量时间 hash 比较、用户 JSON 解析、过期检查和 replay store 接口。
- `packages/telegram/src/webhook.ts`：Secret Token 常量时间比较、`update_id` 结构验证、Memory/D1 去重存储。
- `apps/api/src/app.ts`：`POST /api/v1/auth/telegram` 与 `POST /webhooks/telegram`，拒绝缺少密钥、无效 JSON、错误签名和无效 update。
- `apps/api/migrations/0004_telegram_security.sql`：`telegram_webhook_logs` 与 `telegram_init_data_replays` 持久化表。

当前尚未进行真实 Telegram 外部联调，因为本项目尚未配置 Bot Token、Webhook Secret 和公开 HTTPS Webhook URL。代码和测试不会把缺少这些配置的环境标记为真实联调成功。

## References

[1]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
[2]: https://core.telegram.org/bots/api "Telegram Bot API"
[3]: https://core.telegram.org/bots/webhooks "Telegram Bot Webhooks Guide"
