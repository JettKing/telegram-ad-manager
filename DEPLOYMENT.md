# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
4. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## 生产 contract

生产 Wrangler 配置使用 `D1_SCHEMA_CONTRACT=production-0009`。在该 contract 下，认证、频道、CRM、套餐、订单、付款、媒体幂等和 Webhook 去重会选择 `production-*.ts` adapter；发布 Cron 选择 `production-publishing.ts`。未设置该值时仍运行开发 schema，避免本地数据库被错误解释。

## 当前生产迁移边界

截至 2026-11-27，只读核验发现 Cloudflare `d1_migrations` 仅记录 `0001_core_foundation.sql`，但在线 schema 已包含多项后续结构。历史生产 SQL 已归档至 `apps/api/production-migrations/archive/`，生产 Wrangler 配置只扫描 `apps/api/production-migrations/active/`。线上 `ad_order_refunds` 尚无 0018 新字段且退款记录数为 0。0018 目前已在验证通过的生产备份副本和 Wrangler local rehearsal 上执行成功，尚未写入生产 D1。

订阅接口仍受 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED` 保护；本次财务首发范围是运营代建订单及人工 CNY 收款/退款，退款批准与实际出款分开。

## 当前线上地址

- 前端：`https://telegram-ad-manager.pages.dev`
- API Worker：`https://tg-ad-manager-api.huaaplus.workers.dev`
- 前端通过 `VITE_API_BASE_URL` 访问 API；Worker 通过 `WEB_APP_ORIGIN` 仅允许 Pages 生产域名跨域访问。
- GitHub Actions：`.github/workflows/deploy-frontend.yml` 自动部署 Pages，`.github/workflows/deploy-backend.yml` 手动部署 Worker。
- Telegram Webhook：`.github/workflows/configure-telegram-webhook.yml` 已成功注册并验证 `/webhooks/telegram`。

## 生产部署顺序与操作

生产操作须使用当前 commit 和已验证的备份；本地与 CI 通过不等于生产完成。先重新运行并下载/验证 `.github/workflows/backup-production-d1.yml` 产物，确认生产 schema 未漂移，再执行以下迁移命令。配置只暴露 active 子目录，因此 Wrangler 应列出 0018，而不能列出 0009–0017：

```bash
pnpm cf:config:check
pnpm typecheck && pnpm lint && pnpm test && pnpm build
npx wrangler d1 migrations list tg-ad-manager --remote --config wrangler.production.jsonc
npx wrangler d1 migrations apply tg-ad-manager --remote --config wrangler.production.jsonc
```

确认 apply 输出只包含 `0018_refund_disbursement.sql` 后，再单独核验 D1 字段/索引/ledger、部署 Worker，最后检查 Pages 与 Worker 版本、Cron、Webhook/Queue 并完成测试租户/频道和 iPhone Telegram Mini App 验收。不要用 CI 或部署元数据替代真实业务验收。

Worker 部署、Bot 身份和四个运行 Secret 已通过 GitHub Actions 完成。Secrets 只通过 GitHub/Cloudflare Secret 输入，不提交 `.env` 或 Git。
