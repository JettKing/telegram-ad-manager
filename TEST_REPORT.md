# TEST_REPORT

## 2026-11-21 修复分支本地验证

- `pnpm cf:config:check`、`pnpm db:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`：通过。Vitest 共 13 个文件、143 个测试通过。
- `pnpm exec wrangler deploy --dry-run --config wrangler.production.jsonc`：通过；仅生成本地构建，无部署。
- `wrangler d1 migrations list tg-ad-manager --local --persist-to /tmp/tg-ad-manager-migration-isolation --config wrangler.production.jsonc`：无可应用迁移；使用本地隔离数据库，没有对生产 D1 写入。
- 新增 JSONC URL/注释/尾随逗号、配置错误和迁移目录隔离回归测试；频道绑定测试使用模拟 Telegram 和本地 SQLite，覆盖管理员校验、跨租户竞争、解绑与复核交错、权限快照和错误脱敏。Telegram HMAC 使用独立固定向量，并测试等价参数重排防重放。
- 生产 SQLite 测试使用与已知字段和约束对应的局部 fixture，而不是完整生产 schema；并发测试为本地单连接的异步交错，不等同于真实分布式负载测试。频道行与权限快照仍由多条 SQL 写入，不提供跨语句事务。

## 2026-11-21 Cloudflare 只读核对

Pages 首页、Worker `/health/ready` 和 `/api/v1/metadata` 返回 HTTP 200；Worker 已有 D1、Queue、必要 Secret 名称和 Cron。对生产 D1 仅读取 schema、迁移账本和权限快照重复数量：媒体增量对应字段/表存在但账本未记录 0009；登录防重放表 `telegram_init_data_replays` 缺失；未发现重复的频道权限快照。未修改生产 D1、Worker、Secrets 或 Webhook。

## 尚未覆盖

没有执行真实 Telegram WebView 身份认证、测试频道绑定/发送、生产或隔离远程 D1 写入、Cron 发布重试与删除、真实付款审核或订阅/退款端到端测试。健康状态和本地测试不代表生产商业闭环可用，详见 `KNOWN_ISSUES.md` 和 `DEPLOYMENT.md`。
