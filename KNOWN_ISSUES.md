# KNOWN_ISSUES

1. 目前没有 Telegram Bot Token、Webhook Secret、频道管理员权限和公开 HTTPS Webhook URL，因此无法验证真实 Bot/Webhook/频道绑定/媒体接收。
2. D1 Migration 已提交并通过静态顺序检查，但尚未绑定 Cloudflare D1 并执行；当前开发环境不等价于远端 D1 已迁移。
3. 阶段 5 媒体解析和相册状态机已实现，但没有真实 Cron settle worker、R2 文件下载、缩略图、病毒扫描、OCR、音频解析和媒体清理任务。
4. Webhook 更新持久化和素材幂等已实现；Telegram 429/网络重试、失败更新的精细状态恢复、生产并发 D1 事务语义尚未验证。
5. Hono 当前使用 Node adapter 运行开发 API；Workers 入口存在，但 D1 binding、Queues consumer 和 Cron handler 的生产业务逻辑尚未完成。
6. 当前前端业务入口是明确标注的模块壳层，未实现的订单、收入、发布结果不会用固定演示数字填充。
7. Wrangler 模板中的 D1 ID、队列名和生产 Secrets 是待替换占位符，不能直接执行生产部署。
