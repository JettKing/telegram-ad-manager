# KNOWN_ISSUES

1. 目前没有 Telegram Bot Token、Webhook Secret、频道管理员权限和公开 HTTPS Webhook URL，因此无法验证真实 Bot/Webhook/频道绑定/媒体接收。
2. D1 Migration 已提交并通过静态顺序检查，但尚未绑定 Cloudflare D1 并执行；当前开发环境不等价于远端 D1 已迁移。
3. 阶段 6 已实现 CRM、套餐、订单和编辑器代码基线，但付款凭证核账、订单审批 UI、退款流水、排期、Telegram 发布、财务统计和配额限制尚未实现。
4. 订单金额校验和状态迁移已有服务端边界，但真实 D1 事务、并发订单号生成、支付状态回调和生产审计日志尚未验证。
5. 媒体系统已实现入库和相册状态机，但没有真实 Cron settle worker、R2 文件下载、缩略图、病毒扫描、OCR、音频解析和媒体清理任务。
6. Hono 当前使用 Node adapter 运行开发 API；Workers 入口存在，但 D1 binding、Queues consumer 和 Cron handler 的生产业务逻辑尚未完成。
7. 当前前端业务入口是明确标注的模块壳层，未实现的订单、收入、发布结果不会用固定演示数字填充。
