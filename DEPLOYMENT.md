# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
4. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## 生产 contract

生产 Wrangler 配置使用 `D1_SCHEMA_CONTRACT=production-0008`。在该 contract 下，认证、频道、CRM、套餐、订单、付款和 Webhook 去重会选择 `production-*.ts` adapter；发布 Cron 选择 `production-publishing.ts`。未设置该值时仍运行开发 schema，避免本地数据库被错误解释。

## 当前阻塞

生产素材表缺少 Telegram source message/chat 幂等字段，媒体 Webhook 写入和相册状态被显式阻止；生产库没有已确认的退款申请表，退款 API 被显式阻止；排期 HTTP API 还需完成生产 adapter 切换。不要在这些差异未评审前运行远程 Migration。

## 仍需用户确认后的生产操作

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

以上生产写入仍未执行。Secrets 只通过 Cloudflare Secrets 输入，不提交 `.env` 或 Git。
