# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。服务通过 `x-request-id` 传递追踪标识，不在日志中写入 Bot Token、Webhook Secret、Session Secret、付款凭证原文或完整 initData。

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
| GET | `/api/v1/finance/access` | `finance:read` 权限保护的访问边界，不返回虚构财务数字 | 已实现 |
| POST | `/webhooks/telegram` | 验证 Webhook Secret、解析 Update、去重并持久化 | 已实现 |

## Session 约定

认证成功响应返回 `session.token` 和 `session.expiresAt`。客户端后续使用 `Authorization: Bearer <token>`。服务端用 `SESSION_SECRET` 对随机 session id 计算 HMAC 签名，并从 D1 查询 `user_sessions` 的 `revoked_at`、`expires_at`、用户状态、租户成员和工作空间成员。缺少 DB 或 `SESSION_SECRET` 时认证和受保护端点 fail closed，返回 503；错误或过期 Token 返回 401；角色没有所需权限返回 403。

## RBAC 约定

角色固定为 `owner`、`admin`、`manager`、`editor`、`finance`、`viewer`。权限由后端 `hasPermission` 判定，不能通过请求体、URL 参数或前端状态覆盖。Owner/Admin 可管理设置；Manager 可管理频道和发布；Finance 负责财务读取/写入；Viewer 只拥有读取权限。实际业务资源接入时还需要将 tenant_id/workspace_id 条件写入每条查询。

## 尚未开放的接口边界

租户邀请/切换、成员角色变更、频道绑定、CRM、套餐、订单、素材、排期、发布任务、订阅、统计和管理员接口仍按阶段清单逐步实现。现有受保护接口是身份和权限边界，不代表这些业务模块已经完成。
