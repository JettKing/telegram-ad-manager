# Telegram 多媒体素材与相册聚合

阶段 5 根据 Telegram Bot API 的 `Message`、`PhotoSize`、`Video`、`Animation` 和 `Document` 字段解析 Webhook。图片从 `photo[]` 选择最大尺寸的 PhotoSize，保存 `file_id`、`file_unique_id`、宽、高和可选大小；视频、Animation 和 Document 保存各自的文件标识以及可用的时长、尺寸、文件名、MIME 和大小。[1]

每个素材使用 `bot_identity_id + source_chat_id + telegram_message_id` 作为幂等键。相册使用消息的 `media_group_id` 聚合，单条素材存入 `media_assets`，关系写入 `media_group_items`。状态机显式经过 `collecting`、`settling`、`pending_confirmation` 和 `completed`；`media_group_id` 相同但迟到的消息会重新进入 `collecting` 并增加版本。

Webhook 只负责接收和持久化，不在请求内下载原始文件。R2、缩略图、病毒扫描、OCR 和真正的 Cron settle worker 仍需后续阶段实现。所有媒体入库先解析 Tenant/Workspace；相同来源消息解析到另一个租户时拒绝覆盖。

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
