# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
4. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## 生产 contract

生产 Wrangler 配置使用 `D1_SCHEMA_CONTRACT=production-0009`。在该 contract 下，认证、频道、CRM、套餐、订单、付款、媒体幂等和 Webhook 去重会选择 `production-*.ts` adapter；发布 Cron 选择 `production-publishing.ts`。未设置该值时仍运行开发 schema，避免本地数据库被错误解释。

## 当前阻塞

生产库已补充 `creative_media.telegram_message_id/source_chat_id`、幂等索引、`media_groups` 和 `media_group_items`；退款申请表和订阅表仍未接入生产，因此退款/订阅商业接口继续安全阻止。

## 当前线上地址

- 前端：`https://telegram-ad-manager.pages.dev`
- API Worker：`https://tg-ad-manager-api.huaaplus.workers.dev`
- 前端通过 `VITE_API_BASE_URL` 访问 API；Worker 通过 `WEB_APP_ORIGIN` 仅允许 Pages 生产域名跨域访问。
- GitHub Actions：`.github/workflows/deploy-frontend.yml` 自动部署 Pages，`.github/workflows/deploy-backend.yml` 手动部署 Worker。

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

Worker 部署和前三个运行 Secret 已通过 GitHub Actions 完成；`TELEGRAM_BOT_IDENTITY_ID` 仍需在完成生产 Bot 身份初始化后补入。Secrets 只通过 GitHub/Cloudflare Secret 输入，不提交 `.env` 或 Git。
