# KNOWN_ISSUES

1. 目前没有 Telegram Bot Token、Webhook Secret、频道管理员权限和公开 HTTPS Webhook URL，因此无法验证真实 Bot/Webhook/频道绑定/媒体接收/发布/删除。
2. D1 Migration 已提交并通过静态顺序检查，但尚未绑定 Cloudflare D1 并执行；当前开发环境不等价于远端 D1 已迁移。
3. 队列当前使用 D1 表和 Workers Cron polling，没有配置 Cloudflare Queues；真实多实例 claim、恢复 processing 任务和非幂等 Telegram 请求需要生产验证。
4. Telegram 发布器支持 text、photo、video、document/animation 的基础发送，但还没有媒体组原子发布、实体格式转换、pin/edit 策略和多条 message_id 完整记录。
5. 到期处理当前按最新成功发布日志尝试 deleteMessage；删除权限、删除失败重试和多条消息的完整清理仍需增强。
6. 排期支持 once/daily/weekly/custom 字段保存，但周期排期的下一次实例生成尚未实现；当前每条排期创建一个发布任务。
7. 付款凭证仍通过 media asset ID 引用，尚未实现独立 multipart 上传、R2 持久化、病毒扫描和文件访问授权。
8. 支付回调、生产财务对账、SaaS 订阅、财务统计和管理员后台仍未实现。
