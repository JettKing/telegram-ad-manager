# PROJECT_STATUS

## 当前状态

阶段 4 已完成频道绑定与权限检查代码基线，并已通过本地门禁。当前 API 能在已认证的 Tenant/Workspace 上下文中调用 Telegram Bot API，确认目标为 channel，读取 Bot 成员状态与权限，并保存权限快照。

## 阶段 4 已实现

`apps/api/src/channels.ts` 提供 `TelegramBotApiClient`，支持 `getMe`、`getChat`、`getChatMember`，Telegram API 错误不会暴露 Token。`verifyTelegramChannel` 要求 `Chat.type === "channel"`，把 creator/administrator/member 状态映射为发布、编辑/置顶、删除权限。

`D1ChannelRepository` 按 tenant_id、workspace_id 查询频道，提供绑定、复核、列表和软解绑。绑定时使用 Bot identity 与 Telegram chat id 做唯一识别；如果频道属于其他工作空间会拒绝。权限不足仍保存快照并将状态设为 `permission_error`，不会返回可发布成功。

新增接口：`GET /api/v1/channels`、`POST /api/v1/channels/bind`、`POST /api/v1/channels/:channelId/recheck`、`POST /api/v1/channels/:channelId/unbind`。绑定和复核需要 `channel:manage`；列表需要 `channel:read`。

## 检查证据

- `pnpm db:check`：通过，6 份 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm test`：通过，4 个测试文件，13 个测试。
- `pnpm build`：通过。
- 测试覆盖权限快照、非管理员 permission_error、Bot API 请求形状和已有阶段认证/RBAC/会话边界。

## 尚未完成

尚未配置真实 Telegram Bot Token、Bot identity、公开 HTTPS、Cloudflare D1 和测试频道管理员权限，因此没有声称真实频道绑定、getChatMember 或权限联调成功。当前还未实现频道切换历史、审计日志写入、队列发布和 Telegram 429/网络重试策略。

## 下一步

进入多媒体素材系统：接收 Webhook 中的文本、图片、视频、相册、GIF/Animation 和 Document，记录 file_id/file_unique_id/media_group_id，并实现相册聚合状态机。
