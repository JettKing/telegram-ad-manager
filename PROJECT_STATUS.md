# PROJECT_STATUS

## 当前状态

阶段 1 工程基础已保存到 `origin/main`。阶段 2 已实现 Telegram Mini App initData HMAC 验签和 Telegram Webhook 接收边界，当前仍未完成用户会话、租户绑定和真实外部联调。

## 阶段 2 已完成

`packages/telegram/src/index.ts` 使用 Web Crypto 实现官方双层 HMAC-SHA256：以 Bot Token 作为 HMAC key、`WebAppData` 作为 data 派生 secret key，再对按字段排序的 data-check-string 计算 hash。实现了 raw initData 解析、`auth_date` 过期/未来时间检查、Telegram 用户 JSON 解析、常量时间 hash 比较和 replay key。

`apps/api/src/app.ts` 已增加 `POST /api/v1/auth/telegram`。它只接受原始 initData，签名和新鲜度验证通过后才返回用户资料；D1 replay store 存在时使用原子 `INSERT OR IGNORE` claim，发现重放或 replay store 不可用时 fail closed。

`POST /webhooks/telegram` 已验证 `X-Telegram-Bot-Api-Secret-Token`，解析非负整数 `update_id`，并通过 D1 保存 `telegram_updates` 与 `telegram_webhook_logs`。没有 D1 binding 的开发环境使用进程内去重存储，仅用于测试，不代表生产持久化。

## 检查证据

- `pnpm db:check` 通过：4 份迁移文件连续有效。
- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `pnpm test` 通过：2 个测试文件，8 个测试通过。
- `pnpm build` 通过：前端 Vite 和 API TypeScript 构建通过。
- 测试覆盖 HMAC 正例、篡改、过期、replay、Secret Token、未授权 Webhook 和重复 update_id。

## 尚未完成

尚未配置真实 Telegram Bot Token、Webhook Secret 和公开 HTTPS URL，因此没有声称真实 Bot API / Webhook 联调成功。平台用户 upsert、session 签发/撤销、默认 Tenant/Workspace 绑定、Webhook 入队和消息媒体处理仍待实现。Cloudflare D1 远端 Migration 也尚未执行。

## 下一步

实现用户、平台会话和多租户上下文；为 Owner/Admin/Manager/Editor/Finance/Viewer 增加后端权限中间件和越权测试，然后进入频道绑定与权限检查。
