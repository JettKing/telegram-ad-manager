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
| GET | `/api/v1/workspace/context` | `workspace:read` 权限保护的租户/工作空间上下文 | 已实现 |
| GET | `/api/v1/finance/access` | `finance:read` 权限保护的访问边界 | 已实现 |
| GET | `/api/v1/channels` | 当前 Tenant/Workspace 的频道列表 | 已实现 |
| POST | `/api/v1/channels/bind` | 校验 getChat/getMe/getChatMember 并保存频道权限快照 | 已实现 |
| POST | `/api/v1/channels/:channelId/recheck` | 重新读取 Telegram 身份与权限 | 已实现 |
| POST | `/api/v1/channels/:channelId/unbind` | 当前 Tenant/Workspace 下软解绑频道 | 已实现 |
| POST | `/webhooks/telegram` | 验证 Webhook Secret、解析 Update、去重并持久化 | 已实现 |

## 频道绑定

`POST /api/v1/channels/bind` 需要 `channel:manage`，接收 `{ "chatId": "@channel_username 或 chat_id" }`。服务端调用 Telegram `getChat`，要求 `type === "channel"`，随后调用 `getMe` 和 `getChatMember`。发布权限来自 `can_post_messages`，删除权限来自 `can_delete_messages`，频道编辑/置顶相关能力来自 `can_edit_messages`。缺少发布权限会保存记录但返回 422 和 `CHANNEL_PERMISSION_ERROR`。

频道查询、复核和解绑都加入 session 的 tenant_id/workspace_id 条件。频道绑定使用 bot_identity_id + telegram_chat_id 识别重复绑定，跨工作空间绑定返回冲突。

## 尚未开放的接口边界

租户邀请/切换、成员角色变更、频道操作审计、CRM、套餐、订单、素材、排期、发布任务、订阅、统计和管理员接口仍按阶段清单逐步实现。
