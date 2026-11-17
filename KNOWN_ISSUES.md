# KNOWN_ISSUES

1. 目前没有 Telegram Bot Token、Webhook Secret、频道管理员权限和公开 HTTPS Webhook URL，因此无法验证真实 Bot/Webhook/频道绑定/媒体接收/广告发布。
2. D1 Migration 已提交并通过静态顺序检查，但尚未绑定 Cloudflare D1 并执行；当前 `/health/ready` 的数据库状态来自 WebDev 开发环境，不等价于远端 D1 已迁移。
3. 阶段 3 已完成用户 upsert、默认 Tenant/Workspace、平台会话和 RBAC middleware，但生产并发 upsert、D1 事务/批处理语义、会话清理 Cron、租户邀请/切换和成员角色变更尚未完成。
4. Hono 当前使用 Node adapter 运行开发 API；Workers 入口存在，但 D1 binding、Queues consumer 和 Cron handler 的生产业务逻辑尚未完成。
5. 当前前端业务入口是明确标注的模块壳层，未实现的订单、收入、发布结果不会用固定演示数字填充。
6. Wrangler 模板中的 D1 ID、队列名和生产 Secrets 是待替换占位符，不能直接执行生产部署。
