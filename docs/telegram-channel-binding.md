# Telegram 频道绑定与权限检查

阶段 4 使用 Telegram Bot API 的 `getChat`、`getMe` 和 `getChatMember` 完成频道绑定前检查。`getChat` 返回的 `Chat.type` 必须是 `channel`，随后用 `getMe` 获取 Bot user id，再通过 `getChatMember` 读取 Bot 在目标频道的成员状态和管理员权限。

Bot 状态为 `creator` 或 `administrator` 时才进入管理员权限判断。频道发布需要 `can_post_messages`；频道删除需要 `can_delete_messages`；频道编辑和置顶相关能力使用 `can_edit_messages`。如果 Bot 不是管理员或缺少发布权限，系统仍保存频道和权限快照，但状态写为 `permission_error`，绑定接口返回 422，不允许后续流程把它当作可发布频道。

已实现接口：

- `GET /api/v1/channels`：只返回当前 session 的 Tenant/Workspace 频道。
- `POST /api/v1/channels/bind`：要求 `channel:manage`，接收 `{ "chatId": "@channel_username 或 chat_id" }`，调用 Telegram API 后保存频道和权限快照。
- `POST /api/v1/channels/:channelId/recheck`：重新查询 Telegram 身份和权限。
- `POST /api/v1/channels/:channelId/unbind`：按当前 Tenant/Workspace 软解绑，保留记录。

数据库写入使用 `telegram_channels` 和 `telegram_channel_permissions`，并通过已有 Tenant/Workspace 条件避免跨租户读取或解绑。当前真实 Telegram 调用仍需要 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_BOT_IDENTITY_ID`、D1 binding 和目标频道管理员授权。

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
[2]: https://core.telegram.org/bots/api-changelog "Telegram Bot API Changelog"
