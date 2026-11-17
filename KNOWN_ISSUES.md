# KNOWN_ISSUES

1. Cloudflare D1 生产 schema 与仓库旧 API 仍不完全一致。阶段 10 只适配了排期和发布任务；认证、频道、媒体、CRM、付款 API 还需要统一 production adapter。
2. 目标账户当前没有 `tg-ad-manager-api` Worker，Queue `tg-ad-manager-publish` 没有 producer/consumer，DLQ 尚未创建。
3. `wrangler.production.jsonc` 已移除尚未创建的 DLQ 声明；如果生产需要 DLQ，必须先创建并在后续变更中显式绑定。
4. Telegram Token、Webhook Secret、Session Secret 和 Bot identity 尚未写入 Cloudflare Secrets。
5. 阶段 10 只完成本地 adapter 验证，没有执行 D1 migration、Queue 创建、Worker 上传、Secret 写入或 Telegram Webhook 切换。
6. 真实环境仍需验证 D1 并发 claim、Queue 重试、Cron 触发、Telegram 429、非幂等请求恢复、完整 message ID 删除和跨租户隔离。
