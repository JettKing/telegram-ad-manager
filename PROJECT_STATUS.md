# PROJECT_STATUS

状态核对日期：2026-11-27（Asia/Shanghai）

## 总体判断

项目处于**核心运营代码、生产迁移及前后端部署已完成；真实生产业务验收仍未完成**阶段。首发范围为运营团队代建订单，以及按 CNY、USD、TON、USDT 记账的人工收款/退款；USDT 网络仅支持 TON、TRON，退款批准与实际出款分开。迁移前已批准退款须逐笔核对银行/支付渠道流水；旧版审批账本不是实际转账证明，核对前 API 阻止再次出款。

## 仓库与近期验证

- 当前分支：`main`；远端最新提交为 `fc19b5a281961794d31d95ae900c008a7c707230`（币种选项仅显示代码）。
- 最近财务提交：`55d3e0c` 支持多币种人工记账/退款及迁移 0019；随后 `fc19b5a` 统一前端币种简称显示。
- 最近 UI 变更包括统一 iOS 风格、Telegram Mini App 动态视口/安全区适配，以及订单素材面板和付款凭证选择框宽度对齐。
- 最新本地/CI 验证：70 项测试及生产财务 SQLite 集成通过；typecheck、db:check、build、lint、`git diff --check` 均通过。
- 财务 SQLite fixture 实际执行生产迁移 0018、0019，覆盖退款历史核对、幂等重放与载荷冲突、额度预留、出款登记及 batch 回滚，并覆盖 TON/USDT 资产精度、网络与账本关联。该 fixture 不证明目标生产 D1 同构；隔离 Cloudflare D1 同构测试和真实业务验收仍缺。
- 最新前端 commit `fc19b5a` 对应 GitHub CI run `45932615488` 与 Pages run `45932615514` 均成功。部署成功不替代真实生产业务验收。

## 当前代码覆盖

- **身份与权限**：Telegram Mini App 登录、session、租户/工作空间上下文及 RBAC 基础。
- **核心运营**：频道绑定、客户/套餐、订单创建与提交、付款凭证、付款审核、财务对账、排期和发布任务运维。
- **媒体**：Telegram 媒体接入、审核、替换、订单素材选择和发布前预览等代码路径。
- **成员与审计**：成员查询、角色更新、暂停/恢复，以及审计日志 API/管理端查询页面已存在；邀请和完整成员生命周期仍有限。
- **客户通知**：outbox/Cron 通知实现已在代码和项目既有状态记录中；真实客户会话配置及送达需单独验证。
- **订阅**：本地 schema 和订阅业务逻辑存在；生产 contract 在 `apps/api/src/app.ts` 中明确以 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED` 阻止生产订阅接口，不能标为生产可用。
- **财务资产**：生产迁移 `0019_multi_currency_finance.sql` 已应用；账务支持 CNY、USD、TON、USDT，按资产精度和网络记录。USDT 只开放 TON、TRON；前端与后端目录的币种标签统一为代码。
- **退款**：生产支付 adapter 已包含退款读写/审核实现；迁移 `0018_refund_disbursement.sql` 记录实际出款时间、操作者、方式和流水号，并加入请求幂等索引。迁移兼容旧版随机退款账本 ID；所有迁移前批准记录均要求人工核对，Finance 单列“历史待核对”，API 阻止再次出款。Finance UI 已实现批准与实际出款分离；无受审计解锁流程。部署后退款记录数为 0。

## 部署与生产集成边界

- 后端生产 workflow `45931956483` 成功：迁移前备份并验证 D1，应用 0019、部署 Worker、配置运行 secrets 并验证 Bot identity；此前 workflow `45921992737` 已应用 0018。生产账本记录 0018/0019；退款记录为 0。付款幂等键空值和重复组均为 0。
- 应用自有 `schema_migrations` 仍记录 0001–0008，与 Wrangler 的 `d1_migrations` 是不同账本；不可伪造 0009–0017 已执行，也不可将归档迁移重新放入 active。生产 Wrangler 只扫描 `apps/api/production-migrations/active/`。
- 最新生产部署 run `45931956483` 已在迁移前验证并上传备份 artifact；此前 run `45921992737` 的 48 表 SQLite integrity 和 0018 前置条件校验通过，下载副本二次验证通过。
- 后端 workflow `45931956483` 已完成 0019 后的 Worker 部署步骤。此前已核验 Worker 健康接口 `/health`、`/health/ready`、`/api/v1/health` 均 HTTP 200，readiness=true；`*/5 * * * *` 已配置，较早 `production_cron` 快照为 `ok`（`2026-11-27T01:25:54.709Z`，零任务、零失败）。这些健康/Cron 数据是既往核验记录，不是 0019 部署后的重新探测。
- Queue 查询为 0 consumer；代码没有 Queue `.send()` 或 handler，实际发布/通知通过 D1 polling + Cron，Queue producer binding 暂闲。Webhook 历史日志有 4 条 accepted/200，最新 2026-11-26T15:52:21Z；4 条更新记录状态为 `received`。这不能证明本次部署后 Telegram 送达。

## 尚未完成 / 下一步

- 本轮本地验证：70 项测试、生产财务 SQLite 集成、typecheck、db:check、build、lint 和 `git diff --check` 通过；CI run `45932615488` 亦通过。生产 D1 迁移与 Worker/Pages 部署已完成；这仍不等于真实业务验收。

1. **生产 D1 schema 全领域核对**：0018、0019 已应用。仍需对照生产 adapters SQL，逐领域核查身份/成员、频道、CRM、订单、付款、退款、排期/发布、媒体、通知和审计字段；不得批量应用归档迁移。
2. **历史退款人工核对与受审计解锁**：本次在线查询为退款记录 0、已批准历史退款 0，当前无存量流水待核对；若迁移前旧记录重新出现，仍须逐笔用银行/支付渠道流水核验，开发受审计的 reconciled/actual-not-paid 流程并明确账本冲销，不能直接清除 `disbursement_legacy_inferred`。
3. **隔离 D1 集成回归**：验证生产 adapters 的读写、租户边界、付款/退款、排期、发布 claim/lease/重试及 Cron 路径。
4. **真实 Telegram E2E**：用测试租户和测试频道完成登录、绑定、媒体、订单、多币种人工付款审核、退款审批与实际出款（测试流水）、排期、发布与失败恢复；财务覆盖 CNY、USD、TON、USDT（USDT 网络仅 TON、TRON）。另验客户通知真实送达。当前没有执行真实付款/退款。
5. **真实 iPhone Telegram WebView 逐页验收**：检查安全区/视口、侧栏滚动、长表单、输入键盘、表格横向查看和日期控件；复核订单素材/凭证选择器及 Finance 出款 UI。CI/Pages 成功不等于视觉验收。
6. **后续产品功能**：客户自助下单入口（不属于已确认首发范围）；客户/套餐/频道编辑归档能力；如有业务需求再扩展成员邀请与完整移除。

## 文档一致性说明

本仓库其他历史文档（例如 `PRODUCTION_INTEGRATION.md`、`PRODUCTION_READINESS_AUDIT.md`、`KNOWN_ISSUES.md`）可能记录较早的 schema 或功能状态。代码/CI、部署和真实生产业务验收须分别陈述；没有测试租户/频道、实际通知或真实设备证据前不得声称已完成端到端验收。
