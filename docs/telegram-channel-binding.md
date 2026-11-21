# Telegram 频道绑定与权限检查

绑定要求平台会话具备 `channel:manage`。服务端通过 Telegram Bot API 的 `getChat`、`getMe` 和 `getChatMember` 检查目标是频道及 Bot 的权限，并使用**已验证会话中的 Telegram 用户 ID**另行查询操作者在该频道的成员身份。只有频道创建者或管理员可以绑定；普通成员返回 `CHANNEL_USER_NOT_ADMIN`（403），身份无效或上游验证失败时拒绝绑定，不信任请求体中提供的用户 ID。

Bot 状态必须为 `creator` 或 `administrator` 才能有发布/删除/编辑权限；发布需要 `can_post_messages`。如果用户是频道管理员，但 Bot 不是管理员或缺少发布权限，仍可保存频道和权限快照为 `permission_error`，绑定接口返回 422；若 Telegram 无法核实用户身份，则不会保存。重新检查已绑定频道仅刷新 Bot 权限，不重新判定操作人的 Telegram 频道身份，仍受平台 RBAC 与工作空间隔离保护。已解绑或归档的频道不可通过重新检查复活；重新绑定需要再次验证操作人的 Telegram 管理员身份。

数据库使用条件冲突更新保护 `(bot_identity_id, telegram_chat_id)` 的现有租户与工作空间归属；其他工作空间尝试绑定时返回 `CHANNEL_ALREADY_BOUND`（409），不写入权限快照。重新检查按身份、状态与版本条件更新；频道记录和权限快照仍是多条语句，异常或并发时可能存在暂时不一致，需进一步事务化。

- `GET /api/v1/channels`：返回当前会话工作空间的频道。
- `POST /api/v1/channels/bind`：接收 `{ "chatId": "@channel_username 或 chat_id" }` 并验证操作者及 Bot。
- `POST /api/v1/channels/:channelId/recheck`：重新查询 Bot 的 Telegram 权限。
- `POST /api/v1/channels/:channelId/unbind`：按当前 Tenant/Workspace 软解绑并保留记录。

真实调用需要 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_BOT_IDENTITY_ID`、D1 binding，并需要 Bot 能查询成员状态。验证失败时请检查 Bot 是否已加入频道及拥有必要管理员权限。修改部署前仍需在隔离测试频道完成 Telegram 端到端验收。

参考：[Telegram Bot API](https://core.telegram.org/bots/api)。
