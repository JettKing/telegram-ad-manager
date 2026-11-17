# 排期、Telegram 发布队列与到期处理

阶段 8 使用 `ad_schedules`、`ad_publish_tasks` 和 `ad_publish_logs`。只有 approved 订单可以创建排期；创建排期会写入 `schedule:<scheduleId>` 唯一幂等键和 queued 任务。Workers scheduled handler 周期调用 D1 repository，使用条件更新将 queued 任务 claim 为 processing，避免简单的重复领取。

Telegram 发布按订单内容和素材类型选择 sendMessage、sendPhoto、sendVideo 或 sendDocument。429 错误优先使用 Telegram 返回的 retry_after；网络或服务错误使用有上限的指数退避，永久 API 错误不重复重试。成功记录 message_id，并将 scheduled/publishing 订单推进到 published。

到期处理查找 `planned_end_at <= now` 的 published 订单，用最新成功发布日志中的 chat/message ID 调用 deleteMessage。删除成功后订单进入 completed；删除失败保留 published 并写失败日志。

当前是 D1 polling 的队列基线，不是已配置的 Cloudflare Queues 生产实现。周期排期、媒体组原子发布、多消息清理和真实 Telegram/D1/Workers 外部联调仍待后续阶段。
