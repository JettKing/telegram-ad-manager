# DEPLOYMENT

## 本地检查

使用 Node.js 22+ 和仓库锁定的 pnpm 版本：

```bash
pnpm install --frozen-lockfile
pnpm cf:config:check
pnpm db:check
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm exec wrangler deploy --dry-run --config wrangler.production.jsonc
```

`db:check` 只检查开发迁移文件，不检查生产 schema 或远程迁移记录。dry-run 只构建，不部署。

## 生产 D1：暂停自动迁移

**不要使用开发目录 `apps/api/migrations` 对生产 D1 执行迁移，也不要重放归档的 `0009_media_ingestion.sql`。** 2026-11-21 只读核对发现，目标生产库已包含 0009 对应媒体字段和表，而 Wrangler 的 `d1_migrations` 只记录 `0001_core_foundation.sql`，未记录 0009；这与开发迁移链不同。

生产 Wrangler 配置指向独立的 `apps/api/production-migrations`。目录顶层故意没有 SQL；历史文件放在 `archive/`，不属于默认迁移匹配范围。`cf:config:check` 检查该隔离和绑定，并在 CI 与后端部署前运行。这是降低误操作风险的临时措施，**不是完整可重建的生产迁移链，也不能阻止操作者绕开配置保护**。

在任何生产数据库写入之前，必须先备份并验证可恢复性，核对线上 schema 和迁移账本、建立可重放的生产基线、审查具体差异和回滚方案，并在隔离 D1 验证；之后还须取得明确生产操作确认。不要在 CI 中自动执行未审计的迁移。

2026-11-21 只读查询发现生产库缺少 `telegram_init_data_replays`。当前仓库登录路径依赖该表，缺失时会安全拒绝认证；修正 HMAC 后也不能直接期待登录恢复。必须先设计独立迁移并在隔离 D1 验证，不能关闭防重放。修复版本的重放键使用已验证签名哈希，与旧版 raw initData 哈希不兼容；若存在新旧实例并行或旧记录，可能允许曾使用的签名在有效期内再次通过，切换需协调旧实例和最多 24 小时加 60 秒的默认验证窗口。

## 生产部署边界

- 前端：`https://telegram-ad-manager.pages.dev`；API：`https://tg-ad-manager-api.huaaplus.workers.dev`。
- 2026-11-21 只读核对：Worker 绑定了 D1、Queue、Telegram/会话相关 Secret，并存在五分钟 Cron；Pages 和 API 健康地址返回 HTTP 200。健康检查不证明真实业务流程可用。
- GitHub Actions 中 `deploy-frontend.yml` 在 `main` 的前端相关路径变更后自动部署；`deploy-backend.yml` 需手动触发，使用 production environment。审查分支和 PR 不会自动部署正式前端。
- 生产 Worker 部署、Secret 替换、Webhook 切换和数据库写入应分别评估影响，并在执行前明确确认。Secret 只通过 GitHub/Cloudflare Secret 输入，不提交 `.env` 或 Git。
- 生产 contract 为 `D1_SCHEMA_CONTRACT=production-0009`；生产订阅和退款目前仍不可用。真实 Telegram 频道绑定、收款、排期及发布应使用隔离测试资源验收，切勿把本地测试视作生产验证。
