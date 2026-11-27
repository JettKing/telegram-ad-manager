# TG Ad Manager V1.1 任务清单

状态核对日期：2026-11-27（Asia/Shanghai）

## 当前阶段

**核心运营代码、0018 退款出款迁移、0019 多币种财务迁移及后端 Worker/前端 Pages 部署均已完成；真实生产业务验收尚未完成。** 首发范围为运营团队代建订单、按 CNY、USD、TON、USDT 记账的人工收款/退款；USDT 网络只支持 TON、TRON，退款批准与实际出款分开。迁移前批准退款须核对银行流水，不计为实际已退，API 在核对前阻止再次出款。真实测试租户/频道 E2E 和多币种财务对账仍待完成。客户自助下单不属于首发范围。

状态标记含义：**代码已实现** = 仓库中有相应实现；**已部署** = 有近期部署工作流成功证据；**待线上验证** = 尚未由本次核查证实生产资源/真实业务链路已可用。

## 已完成：核心代码与管理端基础

- [x] Telegram Mini App 身份认证、服务端 session、工作空间隔离和 RBAC 基础。
- [x] 频道绑定、客户与套餐管理、订单创建/提交、付款凭证提交、Finance 付款审核与对账基础。
- [x] 排期创建、发布任务列表/运维、失败重试和到期删除补偿的代码路径。
- [x] Telegram 媒体接入、素材审核、订单素材选择/预览/替换等核心管理端流程。
- [x] 成员列表、角色更新、暂停/恢复，以及审计日志查询的 API 和管理端页面；成员邀请和完整成员生命周期仍不在现有 UI 范围内。
- [x] 客户订单状态通知 outbox/Cron 代码；真实客户会话和消息送达仍待验证。
- [x] 本地订阅计划/权益代码；生产 contract 仍阻止未接入生产 schema 的订阅接口。
- [x] 生产付款额度原子预留、付款/退款审核 D1 batch、付款/退款请求级幂等键、幂等账本、owner 并发保护和发布 uncertain 重试保护已实现；退款批准与实际出款拆分，实际出款要求银行流水号并由操作者确认。生产迁移 0018 与 0019 已应用；Finance 支持 CNY、USD、TON、USDT 和资产精度/网络记账，USDT 仅支持 TON、TRON。Finance UI 已部署，退款行数为 0。迁移前批准退款须人工核对。
- [x] 前端已完成统一 iOS 风格更新、Telegram Mini App 视口/安全区适配及近期移动表单宽度修复。
- [x] 本轮本地/CI 验证：70 项测试及生产财务 SQLite 集成通过；typecheck、db:check、build、lint 和 `git diff --check` 通过。最新前端 commit `fc19b5a` 的 CI run `45932615488` 与 Pages run `45932615514` 成功。CI/部署成功不能替代真实生产验收。

## 下一阶段：生产就绪核验与端到端验收（优先）

### P0 — 生产 D1 和生产 contract 核验

- [x] 已只读核验目标生产 D1（`tg-ad-manager`，ID `d9a4ad54-d504-40d6-abd5-a3e978a8ff5a`）：受控部署已应用 0018 与 0019；退款出款/幂等字段及 0019 多币种财务字段随迁移部署。退款记录为 0。付款幂等键无空值/重复组。迁移前应用 schema 与最新 schema 的读操作均为只读。
- [x] 已将历史 0009–0017 迁移归档到 `apps/api/production-migrations/archive/`，生产 Wrangler 仅扫描 `apps/api/production-migrations/active/`。使用 Wrangler local emulator 从通过验证的生产备份恢复副本后，`migrations list` 仅显示 `0018_refund_disbursement.sql`，`migrations apply` 成功，ledger 随后标记 0018 已应用。该 rehearsal 只改本地 `/tmp` 副本，不表示生产已迁移。
- [x] 已将历史 0009–0017 迁移归档到 `apps/api/production-migrations/archive/`，生产 Wrangler 仅扫描 `apps/api/production-migrations/active/`。早前 Wrangler local emulator rehearsal 只覆盖当时的 0018；此演练只改本地 `/tmp` 副本，不表示生产已迁移。当前 0018、0019 均已通过受控生产 workflow 应用；当前合并迁移链的本地 emulator rehearsal 尚未重复。
- [x] 生产 workflow `45921992737` 在迁移前导出、验证并上传 48 表备份后应用 `0018_refund_disbursement.sql`；后续 workflow `45931956483` 再次备份并验证 D1，应用 `0019_multi_currency_finance.sql`、部署 Worker、配置运行 secrets 并验证 Bot identity。未批量重放归档 0009–0017；应用自有 `schema_migrations` 与 Wrangler ledger 不混淆。
- [x] 已只读统计历史退款存量：在线退款记录 0、迁移前已批准退款 0，因此当前没有历史银行流水需要人工核对；若执行前数据发生变化，必须重新核查。旧审批账本仍不能证明真实转账；将来出现历史批准记录时，需人工流水核对及受审计解锁流程。
- [ ] 对照生产 adapters 实际 SQL，逐领域核查身份/成员、频道、CRM、订单、付款、退款、排期/发布、媒体、通知和审计所需表及字段；形成差异清单，不在审计步骤中写入或删除生产数据。
- [ ] 订阅仍受 `SUBSCRIPTION_SCHEMA_NOT_CONFIGURED` 保护；补齐并验证生产订阅 schema 前，不把订阅接口记为生产可用。
- [ ] 在隔离测试 D1 上覆盖生产 adapters 的读取/写入、付款累计、退款审核、排期、发布 claim/重试和数据隔离；不得用共享生产库做破坏性测试。

### P0 — Telegram 真实业务链路验收

- [ ] 使用测试租户/测试频道完成 Telegram 登录、频道绑定与权限检查、媒体 Webhook 入库/审核、客户与套餐、订单、多币种付款审核与退款审批/实际出款、排期、发布及失败恢复的端到端流程；覆盖 CNY、USD、TON、USDT（USDT 网络仅 TON、TRON）。
- [ ] 验证客户通知的目标会话、真实送达、失败重试和幂等行为；没有真实客户/目标对话证据前，不标记为已验收。
- [x] Worker deployment `80f44704-411b-4dca-9919-e7aeb4604039` / version `31b69fa3-c871-4614-ae2a-0b7d72ad2a27` 为 100%；D1/R2/Telegram readiness configured，`/health`、`/health/ready`、`/api/v1/health` 均 200。Cron `*/5 * * * *` 已配置，最终部署后的 `production_cron` 快照 `ok`（`2026-11-27T01:25:54.709Z`）。
- [x] Pages run `45932615514` 对 `fc19b5a` 成功；对应 CI run `45932615488` 成功。Queue consumer 为 0；代码没有 `.send()`/handler，现行发布/通知走 D1 polling + Cron。
- [ ] Webhook 最近注册验证 workflow 为 2026-11-18；历史 4 条 accepted/200 的最新时间为 2026-11-26，不能证明本次部署后 Telegram 实时送达或处理。

## 后续功能（非当前阻断项）

### P1 — 客户自助下单（不属于已确认首发范围）

- [x] 首发由运营团队在后台代建订单；客户 Telegram 自助下单不纳入当前首发范围。
- [ ] 如纳入范围，提供客户查看套餐、选择频道/时间、提交广告内容、查看订单和应付金额、提交付款信息及查看审核结果的自助入口。

### P1 — 管理功能增强与角色治理

- [ ] 客户编辑/归档；套餐编辑/停售/改价；频道解绑/归档及权限重新检查。
- [ ] 对仍被订单引用的客户、套餐和频道增加安全约束。
- [ ] 若业务需要，补齐成员邀请与完整移除流程；当前页面已有角色调整和暂停/恢复能力。
- [ ] 验证 Finance 最小权限与管理配置权限边界，并将证据补入角色验收记录。

### P1 — 媒体和通知完善

- [ ] 核验媒体类型、大小限制及上传/选择流程，并按验收结果补充限制和错误提示。
- [ ] 运营配置真实客户 Telegram ID/会话后验证通知送达、重试和重复事件幂等。

## 状态维护规则

- 功能只有代码时标记“代码已实现”；只有确认对应线上资源和版本时标记“已部署”；真实用户/Telegram/生产数据流程通过后才能标记“已验收”。
- 生产 schema 是否应用以线上只读 migration 状态为准，不以迁移文件存在或前端 CI 成功推断。
