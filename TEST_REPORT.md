# TEST_REPORT

## 阶段 1 结果（2026-11-17）

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm install` | 通过 | 依赖安装完成；esbuild 构建脚本按 pnpm allowBuilds 策略执行 |
| `pnpm db:check` | 通过 | 3 份 Migration 编号连续且包含结构语句 |
| `pnpm typecheck` | 通过 | contracts、telegram、api、web 均完成 |
| `pnpm lint` | 通过 | 当前 lint 命令执行各包 TypeScript 检查 |
| `pnpm test` | 通过 | 1 个测试文件，3 个边界测试通过 |
| `pnpm build` | 通过 | Vite 前端和 API TypeScript 生产构建通过 |
| `GET /health` | 通过 | 本地 HTTP 200，返回版本和依赖状态 |
| `GET /health/ready` | 通过 | 当前 WebDev 托管数据库可用，HTTP 200 |
| `GET /api/v1/health` | 通过 | 统一 `{ok,data,requestId}` 响应 |
| `GET /manus-routes.json` | 通过 | 前端 HTTP 200，路由清单为有效 JSON |

## 外部集成条件

Telegram initData、Webhook、频道权限、Cloudflare D1 远端 Migration、Queues、Cron、R2 和真实发布尚未提供外部配置，因此不属于已通过的真实外部测试。后续报告必须分别写明本地、单元、集成、真实外部服务条件。
