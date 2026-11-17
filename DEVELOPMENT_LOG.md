# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 3 用户、平台会话与 RBAC

实现 `apps/api/src/identity.ts`：Telegram 用户幂等 upsert；首次登录自动创建默认 Tenant、Workspace、Owner tenant member 和 workspace member；已有用户复用最早的 active 租户/工作空间。

平台会话使用随机 session id。数据库只保存 session 状态，返回值是 `base64url(session_id).HMAC-SHA256(SESSION_SECRET, session_id)`。每次受保护请求都重新校验签名，并查询用户状态、会话撤销时间、过期时间、Tenant Member 和 Workspace Member；退出登录写入 `revoked_at`。

实现 Owner/Admin/Manager/Editor/Finance/Viewer 权限矩阵和后端 middleware，新增 `/api/v1/auth/me`、`/api/v1/auth/logout`、`/api/v1/workspace/context`、`/api/v1/finance/access`。新增 `0005_identity_sessions.sql` 查询索引。

本阶段实际门禁：5 份 Migration 校验通过，typecheck/lint/build 通过，3 个测试文件的 10 个测试通过。真实 Cloudflare D1、Telegram 外部服务和生产并发行为仍未联调。

## 2026-11-17 — 阶段 2 Telegram 认证与 Webhook

实现 Mini App initData HMAC-SHA256、auth_date、replay 防护、Webhook Secret、Update 去重和 D1 记录。

## 2026-11-17 — 阶段 1 基线

完成项目初始化、React/Vite 前端、Hono API、共享契约、Migration、路由清单、健康探针、Workers 入口和基础文档。
