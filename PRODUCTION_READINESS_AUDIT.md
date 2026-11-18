# TG Ad Manager V1.1 全项目商业可运营性审计

审计时间：2026-11-19 02:08（Asia/Shanghai）  
审计范围：Telegram Mini App、Worker API、Cloudflare D1 生产 schema、Webhook、支付/退款、排期/发布、订阅、GitHub Actions 和 Pages/Worker 线上状态。

## 结论

当前项目**不能判定为商业可运营版**。本地类型检查、40 个自动化测试和生产构建通过，只能说明代码可编译，不能证明 Telegram WebView 登录、生产 D1 schema、付款审核、排期发布和订阅商业闭环可用。

当前应停止继续扩展功能，先完成 P0 阻断和真实 smoke test。

## P0：不上线前必须修复

### P0-1：Mini App 没有加载 Telegram WebApp SDK

证据：`apps/web/index.html` 没有 `https://telegram.org/js/telegram-web-app.js`；`apps/web/src/main.tsx` 没有调用 `Telegram.WebApp.ready()`；而 `apps/web/src/lib/api.ts` 直接读取 `window.Telegram.WebApp.initData`。

影响：真实 Telegram Mini App 中很可能拿不到 `initData`，随后 `/api/v1/auth/telegram` 返回 `INIT_DATA_REQUIRED`，用户无法登录。

修复：加入官方 SDK、调用 `ready/expand`，并增加真实 Telegram WebView 登录 smoke test。

### P0-2：生产 schema 与迁移链不一致且无法重建

证据：`wrangler.production.jsonc` 的 `migrations_dir` 指向 `apps/api/migrations`（开发迁移），实际生产增量在 `apps/api/production-migrations/0009_media_ingestion.sql`。生产 adapter 依赖 `ad_customers`、`creative_media`、`payment_submissions`、`financial_ledger_entries`、`publish_tasks`、`publish_task_logs` 等表，但仓库没有一套与这些 adapter 完全匹配、可重放的生产 schema。

影响：新环境或错误迁移历史下，认证、CRM、订单、支付、排期或 Cron 可能出现缺表/缺字段；当前 `db:check` 只能证明本地 11 个开发 migration 文件连续。

修复：建立唯一的 production schema contract；将完整生产 schema 快照和版本迁移纳入仓库，或明确禁止 Wrangler 对独立生产库应用开发迁移，并提供受保护的生产迁移流程。

### P0-3：生产排期/发布 adapter 缺少仓库级 schema 保障

证据：`apps/api/src/production-publishing.ts` 写入 `ad_schedules`、`publish_tasks`、`publish_task_logs`，并依赖 `available_at`、`locked_at`、`completed_at`、`telegram_message_ids_json` 等字段；生产 migration 0009 只处理媒体幂等和相册表，没有排期、队列、日志 schema。

影响：排期创建、发布任务 claim、成功/失败重试和到期删除无法由仓库构建证明，线上可能在 SQL 阶段失败。

修复：补齐生产排期/发布 schema 和索引，并在隔离 D1 上执行完整 publish smoke test。

## P1：严重业务缺口

### P1-1：Mini App 仍不能完成完整订单闭环

当前前端只有频道绑定、客户新增和各模块列表；没有套餐创建、订单创建/编辑/提交、付款凭证提交、付款审核、订单状态操作、排期创建或发布控制入口。

后端虽有对应路由，但前端没有调用，因此“频道 → 客户 → 套餐 → 订单 → 付款 → 审核 → 排期 → 发布”无法由运营人员在产品内完成。

### P1-2：排期 DTO 字段不一致

生产 adapter 返回 `startAt/endAt/createdAt/availableAt` 等 camelCase；前端声明和渲染使用 `scheduled_at`、`created_at` 等 snake_case，真实排期可能显示 `Invalid Date` 或空字段。

### P1-3：生产付款审核错误地把部分付款标记为全额 paid

`apps/api/src/production-payments.ts` 审核 approved 后直接设置订单 `payment_status = paid`，没有比较所有 approved payment 的累计金额与 `total_due_minor`。

影响：部分付款可能错误放行到 paid/发布流程。

### P1-4：生产订阅流程被代码明确关闭

生产 contract 下订阅 plans、overview、checkout 和 admin review 都直接返回 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED`；Worker Cron 也跳过生产订阅续费/到期处理。

### P1-5：生产退款流程明确不可用

生产支付 adapter 的退款查询、创建和审核全部固定抛出 `REFUND_SCHEMA_UNAVAILABLE`，没有退款申请/审核/流水表。

## P2：运维与一致性问题

### P2-1：生产配置校验脚本失败

`pnpm cf:config:check` 实测失败。`scripts/validate-production-config.ts` 用正则删除 `//` 注释，破坏 `WEB_APP_ORIGIN` 的 `https://` 字符串，导致 JSON.parse 抛出 `Bad control character in string literal`。

### P2-2：生产部署 workflow 没有生产 migration job

`.github/workflows/deploy-backend.yml` 只执行构建、Worker 部署和 Secret 配置，没有受保护的生产 D1 migration 步骤；Queue 目前只有 producer 声明，没有 consumer 实现，实际依赖 Cron。

### P2-3：前端运行状态文案曾静态显示成功

应根据真实 health/metadata 响应显示 API、数据库、Telegram 和 R2 状态，不能在请求失败或 schema 未配置时显示 LIVE/已连接。

### P2-4：前端登出没有撤销服务端 session

当前 `logout()` 只删除 localStorage token，没有调用后端 `POST /api/v1/auth/logout`。

## 已验证项目

- `pnpm typecheck`：通过。
- `pnpm test`：通过，10 个测试文件、40 个测试。
- `pnpm build`：通过。
- `pnpm db:check`：通过，但只覆盖开发 migration 连续性。
- Worker `/`、`/health`、`/api/v1/health`：线上返回 200。
- Pages 首页：线上返回 200。
- GitHub Pages 部署：成功。
- Worker 部署：成功。

## 正确整改顺序

1. 加载 Telegram WebApp SDK，完成真实 Mini App auth smoke test。
2. 确定并固化 production schema contract，覆盖身份、频道、CRM、订单、支付、排期、发布、日志和订阅所需表。
3. 在隔离 D1 上执行真实 adapter smoke test：登录、绑定频道、CRM、订单、全额/部分付款、排期、发布、重试、到期删除。
4. 修复付款累计逻辑和排期 DTO。
5. 决定订阅和退款：完成生产 schema 并开放，或明确从 V1.1 商业范围中移除并在 UI 隐藏。
6. 补齐前端订单、付款、审核、排期和发布操作。
7. 修复 JSONC 校验、服务端登出、健康状态文案。
8. 重新执行真实 Telegram 业务验收，验收通过后才能称为商业可运营版。
