# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm db:check`、`pnpm cf:config:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
4. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## 已审计的 Cloudflare 资源

Cloudflare 唯一授权账户为 `bf9869d76a7fcbd9f75aefc5f98f3fbb`。目标 D1 为 `tg-ad-manager`（`d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`），目标 Queue 为 `tg-ad-manager-publish`（`9fc8423242564c1e814108cdf5883208`）。账户当前还没有 `tg-ad-manager-api` Worker，目标 Queue 没有 producer/consumer。

`wrangler.production.jsonc` 已绑定这些真实资源，且 `pnpm cf:config:check` 会阻止占位符配置进入部署流程。该文件不包含任何生产 Secret。

## 重要兼容性阻塞

目标 D1 已有独立的 0001–0008 production schema，表名和当前仓库 Migration 不一致：生产使用 `publish_tasks`、`publish_task_logs`、`creative_media`、`payment_submissions`，仓库代码使用 `ad_publish_tasks`、`ad_publish_logs`、`media_assets`、`ad_order_payments`。因此禁止直接运行仓库 `0010_publish_queue.sql` 或直接上传当前 Worker。必须先完成 schema adapter 和 Queue consumer。

## 需要确认后的生产操作顺序

```bash
pnpm cf:config:check
pnpm typecheck && pnpm lint && pnpm test && pnpm build
npx wrangler d1 migrations apply tg-ad-manager --remote --config wrangler.production.jsonc
npx wrangler queues create tg-ad-manager-publish-dlq
npx wrangler deploy --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.production.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_BOT_IDENTITY_ID --config wrangler.production.jsonc
```

以上命令只是目标顺序，不代表已经执行。尤其是 Migration、DLQ 创建、Worker 上传、Secret 写入和 Telegram Webhook 切换都属于外部生产变更，必须在兼容性适配和明确变更确认后执行。Secret 值只通过 Cloudflare Secrets 输入，不提交 `.env` 或 Git。
