# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
4. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## 生产 contract

生产 Wrangler 配置使用 `D1_SCHEMA_CONTRACT=production-0009`。在该 contract 下，认证、频道、CRM、套餐、订单、付款、媒体幂等和 Webhook 去重会选择 `production-*.ts` adapter；发布 Cron 选择 `production-publishing.ts`。未设置该值时仍运行开发 schema，避免本地数据库被错误解释。

## 当前生产迁移边界

截至 2026-11-27，生产 workflow `45921992737` 已在备份并验证 D1 后应用 `0018_refund_disbursement.sql`，随后部署 Worker。部署后只读核验确认 Wrangler `d1_migrations` 记录 0018，六个退款出款/幂等字段与四个索引存在，退款记录数为 0。历史生产 SQL 仍归档于 `apps/api/production-migrations/archive/`，Wrangler 只扫描 `active/`；禁止重放归档迁移。应用自有 `schema_migrations` 与 Wrangler ledger 是不同账本。

订阅接口仍受 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED` 保护；本次财务首发范围是运营代建订单及人工 CNY 收款/退款，退款批准与实际出款分开。

## 当前线上地址

- 前端：`https://telegram-ad-manager.pages.dev`
- API Worker：`https://tg-ad-manager-api.huaaplus.workers.dev`
- 前端通过 `VITE_API_BASE_URL` 访问 API；Worker 通过 `WEB_APP_ORIGIN` 仅允许 Pages 生产域名跨域访问。
- GitHub Actions：`.github/workflows/deploy-frontend.yml` 自动部署 Pages，`.github/workflows/deploy-backend.yml` 手动部署 Worker。
- Telegram Webhook：`.github/workflows/configure-telegram-webhook.yml` 已成功注册并验证 `/webhooks/telegram`。

## 生产部署顺序与操作

生产操作须使用当前 commit 和已验证备份；本地与 CI 通过不等于生产验收。以下命令说明后续生产变更应使用的流程；本次已部署完成：

```bash
pnpm cf:config:check
pnpm typecheck && pnpm lint && pnpm test && pnpm build
npx wrangler d1 migrations list tg-ad-manager --remote --config wrangler.production.jsonc
npx wrangler d1 migrations apply tg-ad-manager --remote --config wrangler.production.jsonc
```

本次 workflow `45921992737` 在部署前导出并验证 48 表备份，随后应用 0018、部署 Worker、配置运行 secrets 并验证 Bot identity；Worker deployment `80f44704-411b-4dca-9919-e7aeb4604039` / version `31b69fa3-c871-4614-ae2a-0b7d72ad2a27` 为 100%。Finance UI commit `3a7f050` 的 CI 与 Pages workflow 成功，线上 HTML 引用 `index-DSortmaz.js`。`/health`、`/health/ready`、`/api/v1/health` 均 HTTP 200；部署后 Cron 快照 `ok`（`2026-11-27T01:25:54.709Z`）。Queue consumer 为 0，当前发布与通知依赖 D1 polling + Cron；历史 Webhook accepted/200 不能证明本次发布后的送达。测试租户/频道真实流程及 iPhone Telegram Mini App 验收仍待完成；未进行真实收款/退款，不能声称财务端到端验收通过。

Worker 部署、Bot 身份和四个运行 Secret 已通过 GitHub Actions 完成。Secrets 只通过 GitHub/Cloudflare Secret 输入，不提交 `.env` 或 Git。
