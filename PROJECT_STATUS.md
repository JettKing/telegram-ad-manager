# PROJECT_STATUS

## 当前状态

阶段 5 已完成多媒体素材接收和相册聚合代码基线，并通过本地门禁。Telegram Webhook 在完成 update 去重后，会识别消息中的文本、图片、视频、Animation/GIF 和 Document，按当前用户或已绑定频道解析 Tenant/Workspace，再写入 D1 媒体表。

## 阶段 5 已实现

`apps/api/src/media.ts` 提供 Telegram Update 解析器。图片选择最大 PhotoSize，媒体记录保存 `file_id`、`file_unique_id`、文件名、MIME、大小、宽高、时长、caption 和来源消息。文本也作为 `media_type = text` 素材保存。`0007_media_ingestion.sql` 增加来源消息字段和唯一幂等索引。

相册使用 `media_group_id` 建立 `media_groups` 和 `media_group_items`。每个素材先进入 `collecting`，settle worker/API 把它推进到 `settling`，确认窗口完成后进入 `pending_confirmation`，人工或业务确认后进入 `completed`。完成后的迟到消息会重新进入 `collecting` 并增加版本；同一个 Bot、来源 chat 和 message 不能重复创建素材。跨 Tenant/Workspace 的相同消息或相册键会拒绝覆盖。

新增接口：`GET /api/v1/media-assets`、`POST /api/v1/media-groups/:groupId/settle`、`POST /api/v1/media-groups/:groupId/pending-confirmation`、`POST /api/v1/media-groups/:groupId/confirm`。素材角色权限为 `media:read` 和 `media:write`。

## 检查证据

- `pnpm db:check`：通过，7 份 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，5 个测试文件，18 个测试。
- `pnpm build`：通过。
- 测试覆盖多媒体类型、最大图片选择、caption/album 字段、unsupported update 和相册状态转换。

## 尚未完成

尚未在真实 Cloudflare D1 和 Telegram Webhook 上联调。当前没有 Telegram 429/网络重试、真实 Cron settle worker、媒体下载到 R2、缩略图、病毒扫描、OCR、音频类型和媒体删除生命周期；这些不计入本阶段已完成项。

## 下一步

进入 CRM、套餐、订单和编辑器，先建立客户与订单的租户隔离，再把素材引用接入广告内容编辑和审批流。
