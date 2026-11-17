# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
4. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## 已审计的 Cloudflare 资源

账户：`bf9869d76a7fcbd9f75aefc5f98f3fbb`。D1：`tg-ad-manager` / `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`。Queue：`tg-ad-manager-publish` / `9fc8423242564c1e814108cdf5883208`。Worker `tg-ad-manager-api` 尚未创建，Queue 尚无 producer/consumer。

## 生产 schema adapter

生产配置声明 `D1_SCHEMA_CONTRACT=production-0008`。Workers Cron 在该值下使用 `production-publishing.ts`，查询生产的 `publish_tasks`、`publish_task_logs`、`ad_schedules`、`creative_media` 和 `telegram_channel_permissions`。配置中不包含 Secret。

认证、频道、媒体、CRM 和付款 API 仍需要继续适配生产 schema，当前不能宣称整个应用已可直接部署。

## 需要后续确认后的生产操作顺序

```bash
pnpm cf:config:check
pnpm typecheck && pnpm lint && pnpm test && pnpm build
npx wrangler d1 migrations apply tg-ad-manager --remote --config wrangler.production.jsonc
npx wrangler deploy --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.production.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_BOT_IDENTITY_ID --config wrangler.production.jsonc
```

以上命令仍未执行。由于仓库本地 Migration 与生产 schema 不同，生产 Migration 必须先经过 adapter 评审；Secret 只通过 Cloudflare Secrets 输入，不提交 `.env` 或 Git。