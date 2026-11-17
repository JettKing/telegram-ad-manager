# PROJECT_STATUS

## 当前状态

阶段 3 已完成代码基线，并已通过本地门禁。Telegram 认证成功后，现在会幂等 upsert 用户，首次登录创建默认 Tenant/Workspace 和 Owner 成员关系，再签发数据库可撤销的 HMAC Bearer Session。所有需要用户身份的示例接口都通过服务端 session 和角色权限 middleware 保护。

## 阶段 3 已实现

`apps/api/src/identity.ts` 包含用户 upsert、默认租户/工作空间 provision、会话签发、签名校验、过期查询和撤销。Token 只携带签名的 session id，真实身份和租户上下文从 `user_sessions`、`users`、`tenant_members`、`workspace_members` 查询，不信任客户端传入的 user/tenant/role。

RBAC 角色包括 Owner、Admin、Manager、Editor、Finance、Viewer。`workspace:read`、`channel:manage`、`order:write`、`finance:read`、`publish:write`、`settings:write` 等权限由后端矩阵判定。当前提供 `GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`GET /api/v1/workspace/context` 和 `GET /api/v1/finance/access` 作为可验证的受保护 API 边界。

`0005_identity_sessions.sql` 增加会话、活跃成员和工作空间成员查询索引。`.env.example` 已增加 `SESSION_SECRET`、`SESSION_TTL_SECONDS` 和 `TELEGRAM_BOT_IDENTITY_ID`。

## 检查证据

- `pnpm db:check`：通过，5 份 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，3 个测试文件，10 个测试。
- `pnpm build`：通过。
- RBAC 测试覆盖角色隔离；会话测试覆盖签发、错误密钥拒绝、读取和撤销。

## 尚未完成

尚未配置真实 Telegram Bot Token、Webhook Secret、公开 HTTPS URL、Cloudflare D1 远端迁移和真实外部联调。当前没有租户邀请/切换、成员角色变更、审计写入、业务资源级权限和真正会话清理 Cron。

## 下一步

进入频道绑定与权限检查：通过 Telegram Bot API `getChat`/`getChatMember` 真实验证频道身份和发布、置顶、删除权限，并把频道绑定和权限检查写入 tenant/workspace 上下文。
