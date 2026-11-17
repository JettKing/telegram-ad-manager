# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。所有受保护接口从 Bearer Session 解析 Tenant/Workspace，不接受客户端传入的 tenant_id 来扩大查询范围。

## 当前已实现

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/health` | 进程存活探针 | 已实现 |
| GET | `/health/ready` | 必要依赖就绪探针 | 已实现 |
| GET | `/api/v1/health` | 统一响应的运行状态 | 已实现 |
| GET | `/api/v1/metadata` | 产品版本和外部集成配置状态 | 已实现 |
| POST | `/api/v1/auth/telegram` | 验证 initData、upsert 用户、创建默认租户/工作空间并签发 session | 已实现 |
| GET | `/api/v1/auth/me` | 验证 Bearer Session 并返回当前身份上下文 | 已实现 |
| POST | `/api/v1/auth/logout` | 撤销当前数据库会话 | 已实现 |
| GET | `/api/v1/channels` | 当前 Tenant/Workspace 的频道列表 | 已实现 |
| POST | `/api/v1/channels/bind` | 校验频道并保存权限快照 | 已实现 |
| POST | `/api/v1/channels/:channelId/recheck` | 重新读取 Telegram 身份与权限 | 已实现 |
| POST | `/api/v1/channels/:channelId/unbind` | 当前 Tenant/Workspace 下软解绑频道 | 已实现 |
| GET | `/api/v1/media-assets` | 当前 Tenant/Workspace 的最近媒体素材 | 已实现 |
| POST | `/api/v1/media-groups/:groupId/settle` | `collecting → settling`，锁定相册收集窗口 | 已实现 |
| POST | `/api/v1/media-groups/:groupId/pending-confirmation` | `settling → pending_confirmation` | 已实现 |
| POST | `/api/v1/media-groups/:groupId/confirm` | `pending_confirmation → completed` | 已实现 |
| POST | `/webhooks/telegram` | 验证 Webhook Secret、去重并解析媒体 Update | 已实现 |

## 媒体接收

Webhook 支持 `message`、`channel_post`、编辑消息中的 text、photo、video、animation 和 document。图片选择 Telegram `photo[]` 的最大 PhotoSize；媒体写入 `media_assets`，保存 Bot identity、来源 chat、来源 message、文件标识和用户可见元数据。没有可识别媒体的 Update 会返回 `unsupported_update`，不制造空素材。

相册通过 `media_group_id` 写入 `media_groups` 和 `media_group_items`。来源 `bot_identity_id + source_chat_id + telegram_message_id` 是素材幂等键；相册 `bot_identity_id + telegram_media_group_id` 是聚合键。重复 Webhook 会更新同一素材并忽略重复的 group item。若相同键解析到不同 Tenant/Workspace，服务拒绝覆盖。

## 尚未开放的接口边界

媒体下载到 R2、缩略图、病毒扫描、OCR、音频、客户 CRM、套餐、订单、排期、发布任务、订阅、统计和管理员接口仍按阶段清单逐步实现。
