# DEPLOYMENT

## 当前可执行的本地基线

1. 安装 Node.js 22+ 与 pnpm 11。
2. 在项目根目录运行 `pnpm install`。
3. 运行 `pnpm db:check` 检查 Migration 编号和结构语句。
4. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build`。
5. 运行 `pnpm dev`，前端默认监听 3000，API 默认监听 8787。

## Cloudflare 目标部署模板

`wrangler.example.jsonc` 已提供 Workers、D1、Queues、Cron 的配置形状，但其中的 D1 database ID、队列名和 Secrets 都是待替换的明确占位符，不能直接当作部署成功。正式配置需要复制为受控的生产配置，并补齐真实 Cloudflare 资源。

正式部署需要 Cloudflare Workers、D1、Queues、Cron Triggers、可选 R2、Telegram Bot Token/Webhook Secret、Mini App URL、管理员 Telegram ID 和 GitHub Actions Secrets。获得这些配置前，不宣称 Cloudflare 部署或真实 Telegram 发布成功。

迁移执行命令示例（补齐真实资源后执行并记录结果）：

```bash
npx wrangler d1 migrations apply <D1_DATABASE_NAME> --remote
npx wrangler deploy --config wrangler.jsonc
```

正式实现还需要补充 Worker 的 D1 repository 注入、队列消费者、Cron 调度、Webhook 注册/重注册、Secrets 轮换、D1 备份/恢复与 GitHub Actions 部署步骤。生产密钥只通过 Cloudflare Secrets 或 WebDev protected configuration 管理，不提交 `.env`。
