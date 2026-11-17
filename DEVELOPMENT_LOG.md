# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 5 多媒体素材与相册聚合

实现 `apps/api/src/media.ts`，Webhook 支持 text、photo、video、animation/GIF、document 和 channel_post。素材保存 Telegram file_id、file_unique_id、文件名、MIME、大小、尺寸、时长、caption、source_chat_id 和 telegram_message_id。

新增 `0007_media_ingestion.sql`，使用来源消息唯一索引保证 Webhook 重复投递不会创建重复素材。相册按 media_group_id 聚合，显式经历 collecting、settling、pending_confirmation、completed；完成后的迟到消息重新打开 collecting 并递增版本。素材和相册幂等键均检查 Tenant/Workspace，防止跨租户覆盖。

新增媒体列表和相册状态推进 API，并将 media:read/media:write 加入后端 RBAC。阶段门禁通过 7 份 Migration、18 个测试、类型、Lint 和生产构建。真实 Telegram/D1/R2/Cron 仍未联调。

## 2026-11-17 — 阶段 4 频道绑定与 Telegram 权限检查

实现频道身份、管理员权限快照、绑定、复核和软解绑。

## 2026-11-17 — 阶段 3 用户、平台会话与 RBAC

实现用户 upsert、默认租户/工作空间、可撤销 HMAC Bearer Session 和后端 RBAC middleware。

## 2026-11-17 — 阶段 2 Telegram 认证与 Webhook

实现 Mini App initData HMAC-SHA256、auth_date、replay 防护、Webhook Secret、Update 去重和 D1 记录。

## 2026-11-17 — 阶段 1 基线

完成项目初始化、React/Vite 前端、Hono API、共享契约、Migration、路由清单、健康探针、Workers 入口和基础文档。
