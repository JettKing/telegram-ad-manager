# TG Ad Manager V1.1 实施计划

## 1. 目标与边界

TG Ad Manager 是面向 Telegram 频道主、广告运营者和广告代理商的多租户广告管理 SaaS。工程采用增量交付：先建立可以安装、构建、运行、检查健康状态的基线，再以数据模型、权限和业务闭环为顺序逐步接入 Telegram Bot、Mini App、管理员后台、D1 Migration、Queues/Cron 和真实外部服务。

当前首批交付只标记已经实际实现的工程基础，不把尚未配置 Telegram Bot Token、频道管理员权限、Cloudflare D1/Queues 的外部联调标记为完成。

## 2. 技术实现

- Web：React + TypeScript + Vite；移动优先的响应式界面。
- UI：Tailwind 语义化设计令牌与少量组件级 CSS，使用轻量卡片、浅蓝品牌色、白色工作区和淡灰背景。
- API：Hono，开发期通过 Node adapter 运行，生产可迁移到 Cloudflare Workers；统一 `/api/v1` 前缀和错误响应格式。
- 数据库：Cloudflare D1/SQLite 兼容 Migration，所有结构变更落在 `apps/api/migrations`；应用侧保留 repository 边界，禁止页面直接拼 SQL。
- 队列与定时任务：预留 `publish_tasks`、`system_jobs` 和 Cloudflare Queues/Cron adapter，任务设计必须具备幂等键、重试计数、失败状态与人工恢复入口。
- Telegram：`packages/telegram` 单独封装 initData 校验和 Bot API client 边界；未提供 Token 时只做结构化失败，不伪造成功。
- 共享契约：`packages/contracts` 保存 API 响应、身份上下文和健康探针类型。

## 3. 产品设计

### 候选风格

1. Nordic SaaS Control Room（0.06）：极简浅色后台，以清晰的状态和留白建立可信度。
2. Soft Cloud Ledger（0.07）：柔和蓝灰层次结合财务台账式信息组织。
3. Telegram-native Utility（0.05）：更强的移动工具感和即时操作反馈。

选择 **Soft Cloud Ledger**。

- **Design Movement**：Soft Cloud Ledger，借鉴现代 B2B SaaS 与轻量财务工作台。
- **Core Principles**：先看状态再做操作；重要业务有明确的责任边界；移动端优先；信息密度可控。
- **Color Philosophy**：浅蓝用于可信、连接和运行状态；白色承载工作内容；淡灰分隔层级；深蓝灰承载文字，避免过度彩色造成运营误判。
- **Layout Paradigm**：左侧工作空间导航 + 右侧纵向工作台；首页不是数据大屏，而是“今日运行状态、待处理事项、模块入口”的连续流。
- **Signature Elements**：细线状态轨道、蓝色运行指示点、带边界标签的业务状态芯片。
- **Interaction Philosophy**：每个操作都说明当前状态、下一步和失败处理方式；未配置的外部服务以可解释的待配置状态出现。
- **Animation**：仅使用 150–200ms 的淡入、状态点呼吸和按钮反馈；不使用装饰性连续动画。
- **Typography System**：系统无衬线字体优先；标题 28/34，区块标题 16/22，正文 14/20，辅助信息 12/18；数字不使用夸张超大字号。
- **Brand Essence**：让 Telegram 广告运营从手工追踪变成可审计、可排期、可恢复的业务流程；可靠、清晰、克制。
- **Brand Voice**：标题直接说明运营动作；CTA 说明结果。例：“把下一条广告安排在正确的时间。”、“先完成频道授权，再开启自动发布。”
- **Wordmark & Logo**：由“TG”双竖线与一条向右推进的消息轨道组成，不使用虎头或复杂渐变。
- **Signature Brand Color**：`#2F80ED`，用于关键操作、状态轨道和品牌识别。

## 4. 项目结构

```text
apps/web/                 Mini App / 管理后台共享前端
  src/components/         导航、状态、统计和通用交互组件
  src/pages/              页面级入口
  src/lib/                API client 与格式化
apps/api/                 Hono API 与迁移
  src/                    路由、错误、运行时边界
  migrations/             D1/SQLite 版本化结构
packages/contracts/       前后端共享类型和响应契约
packages/telegram/        initData 与 Telegram API 边界
public/                   路由清单和静态元数据
tests/                    单元与契约测试
docs/                     运营、恢复和外部服务说明
.github/workflows/        CI 检查
```

## 5. 增量顺序

1. 工程基础：本文件、文档基线、Vite/Hono、路由清单、健康检查、D1 Migration。
2. 身份与多租户：initData 验证、会话、Tenant/Workspace/Member、角色权限和后端租户边界。
3. Bot 与频道绑定：Webhook 去重、频道权限检查、绑定/重新验证。
4. 素材系统：媒体接收、相册聚合、file_id 归属和素材中心。
5. CRM/套餐/订单：状态机、付款凭证、审核和审计。
6. 编辑器/排期：媒体校验、预览、模板、冲突检查。
7. 发布/到期：队列、真实 Telegram API、429/超时/不确定状态、取消置顶和删除失败恢复。
8. 订阅/财务/统计/管理员：权益、流水、报表、审计和系统监控。

## 6. 完整构建工作流

每个阶段均使用：安装依赖 → 语言诊断 → 单元/契约测试 → typecheck → lint → production build → 代码审查 → 更新状态文档。需要外部服务的验收单独记录“本地/单元/集成/真实外部服务”条件。生产部署前再补充 D1、Queues、Cron、Secrets 和 Webhook 注册，不把本地探针结果写成真实 Telegram 发布验证。

## 7. 阶段 15 架构设计：统计报表、收入分析与 Super Admin Dashboard

### 7.1 目标与边界

阶段 15 为 TG Ad Manager 建立可审计、可复算、严格区分租户范围与平台范围的统计体系，并在现有 React/Vite 管理台中实现两个消费层：

1. 租户运营报表：订单、回款、发布履约、客户和频道表现。
2. Super Admin Dashboard：全平台租户、订阅、平台收入、订单 GMV、支付审核、运行健康和异常概览。

首版只读取已经落库的业务事实，不在统计接口中创建、修改或补写业务数据。所有金额使用最小货币单位整数（`amount_minor`），前端只负责格式化；所有时间在 API 内按 UTC 存储，并按请求的 IANA 时区做日期边界转换。

阶段 15 不默认引入 OLAP、外部 BI 或 Redis。Cloudflare D1 是当前事实源；生产 D1 Schema 与本地 Schema 不一致时，继续使用 production adapter，并明确返回 schema 不可用错误，不能回退到旧表或演示数据。

### 7.2 统计口径

#### 订单与收入

- 订单数按 `ad_orders.created_at` 计数，可按订单状态筛选；草稿不计入“有效订单”。
- 应收金额使用开发 Schema 的 `receivable_minor` 或生产等价字段 `total_due_minor`，只作为销售漏斗指标，不等同于已收收入。
- 已收广告收入优先使用已审核通过的付款事实和 `financial_transactions` 中 `source_type='ad_order'`、`direction='credit'`、`status='confirmed'` 的流水；禁止直接把所有订单金额相加。
- 退款金额使用已批准退款对应的 debit 流水或退款台账事实；退款不能重复冲减。
- 净广告收入 = 已收广告收入 - 已确认退款。
- SaaS 收入使用 `financial_transactions` 中 `source_type='saas_subscription'`、`direction='credit'`、`status='confirmed'` 的流水；订阅申请为 `pending` 时不计收入。
- 平台总收入 = 广告净收入 + SaaS 收入，并且必须返回分项，避免把租户经营收入和平台订阅收入混淆。

#### 履约与 SaaS 经营

- 发布成功率 = `ad_publish_logs.result='succeeded'` / 已执行发布尝试总数；queued 任务不计失败。
- `failed` 和 `uncertain` 分开显示；`uncertain` 代表 Telegram 外部结果不确定。
- MRR：有效月付订阅计划价之和；年付按年价 / 12 归一化；终身计划不计入 MRR，但单独计入一次性收入。
- 付费租户：当前计划不为 `free` 且状态为 `active` / `trialing` 的租户。
- 订阅转换率：期间内从 FREE 转为付费的去重租户数 / 期间开始时 FREE 租户数；分母为 0 时返回 `null`，不返回 0。
- 流失率：期间开始时有效付费订阅、期间结束前变为 `expired` / `cancelled` 且未恢复的租户数 / 期间开始付费租户数。
- 订阅审核积压：`subscription_checkout_requests.status='pending'` 的数量、最老申请时间和金额。

### 7.3 后端分层

新增 `apps/api/src/analytics.ts`，负责日期范围和时区解析、统一统计 DTO、开发 Schema 查询仓储、权限可调用查询方法和错误映射；新增 `apps/api/src/production-analytics.ts`，负责 `production-0008` 的只读适配。

建议的查询边界：

```ts
interface AnalyticsScope {
  tenantId?: string;
  workspaceId?: string;
  timezone: string;
  from: string;
  to: string;
}

interface TenantAnalyticsRepository {
  overview(scope: AnalyticsScope): Promise<AnalyticsOverview>;
  revenueTrend(scope: AnalyticsScope, grain: "day" | "week" | "month"): Promise<RevenuePoint[]>;
  orderFunnel(scope: AnalyticsScope): Promise<OrderFunnel>;
  channelRanking(scope: AnalyticsScope, limit: number): Promise<ChannelMetric[]>;
  publishingHealth(scope: AnalyticsScope): Promise<PublishingHealth>;
}

interface PlatformAnalyticsRepository {
  overview(scope: AnalyticsScope): Promise<PlatformOverview>;
  tenantGrowth(scope: AnalyticsScope): Promise<GrowthPoint[]>;
  subscriptionMix(scope: AnalyticsScope): Promise<SubscriptionMix>;
  revenueBreakdown(scope: AnalyticsScope): Promise<PlatformRevenueBreakdown>;
  pendingReviews(): Promise<PendingReviewSummary>;
  operationalHealth(): Promise<OperationalHealth>;
}
```

生产 adapter 只允许查询已确认的生产字段。若某项统计依赖生产缺失的订阅、退款、媒体或财务表，返回稳定错误码 `ANALYTICS_SCHEMA_UNAVAILABLE`，Dashboard 显示“生产 Schema 未接入”，不能显示伪造的 0。

### 7.4 API 契约

租户范围：

- `GET /api/v1/analytics/overview`
- `GET /api/v1/analytics/revenue?from=&to=&grain=&timezone=`
- `GET /api/v1/analytics/orders/funnel?from=&to=`
- `GET /api/v1/analytics/channels?from=&to=&limit=`
- `GET /api/v1/analytics/publishing?from=&to=`

平台范围：

- `GET /api/v1/admin/analytics/overview`
- `GET /api/v1/admin/analytics/revenue`
- `GET /api/v1/admin/analytics/tenants`
- `GET /api/v1/admin/analytics/subscriptions`
- `GET /api/v1/admin/analytics/reviews`
- `GET /api/v1/admin/analytics/operations`

统一返回 `{ ok, data, requestId }`。金额字段返回 `{ amountMinor, currency }`，避免前端自行猜测精度。时间范围最大 366 天，列表默认 100 条，平台排行榜默认 50 条，超出范围返回参数错误。

### 7.5 权限与多租户边界

- 租户报表要求 `analytics:read`，范围必须从 Session 的 `tenantId` 和 `workspaceId` 派生；客户端传入的范围只能校验，不能覆盖 Session。
- Finance 可读取财务金额指标，但不读取不必要的客户敏感字段。
- Owner/Admin 读取完整租户报表；Manager 读取运营指标；Viewer 只读且隐藏财务明细。
- Super Admin 复用 `PLATFORM_ADMIN_TELEGRAM_IDS` 白名单；平台接口明确执行全平台只读聚合，并返回脱敏租户标识。
- 平台接口记录管理员 user id、endpoint、时间范围、结果状态和 request id；统计读取不创建业务流水。

### 7.6 数据库与性能策略

第一阶段先使用 D1 实时聚合，必要索引以真实字段审计为前提：

- `ad_orders(tenant_id, created_at, status)`
- `ad_orders(tenant_id, channel_id, created_at)`
- `financial_transactions(tenant_id, occurred_at, source_type, status)`
- `ad_publish_logs(executed_at, result)`
- `ad_publish_tasks(tenant_id, created_at, status)`
- `subscription_checkout_requests(status, created_at)`
- `tenant_subscriptions(status, current_period_end)`

首版不直接引入快照表。若实时聚合在真实数据量下出现 D1 延迟或成本问题，再增加 `analytics_daily_snapshots` 与 `analytics_refresh_runs`：每日 Cron 生成前一天快照、使用幂等键、保留计算版本和源数据范围；当日继续实时查询，历史日期优先读取快照。

### 7.7 前端 Dashboard 结构

在现有占位导航基础上增加独立 `/analytics` 与 `/admin` 区域，不把平台数据混入普通租户首页。

租户侧：时间范围与时区选择、KPI 卡片、收入趋势、订单漏斗、频道排行、发布成功率和异常任务。Super Admin 侧：经营总览、收入分析、租户增长、订阅组合、运营健康和审核中心。

新增 `apps/web/src/lib/analytics-api.ts`，统一处理 Bearer Session、查询参数编码、AbortController、错误映射及 Loading / Empty / Forbidden / SchemaUnavailable / Error 状态。图表组件只接收后端聚合 DTO，不在 React 中计算收入口径；优先使用轻量 SVG/CSS，首版不为一个折线图引入大型图表依赖。

视觉沿用当前 Soft Cloud Ledger：浅色工作台、深蓝文字、青绿色正常状态、橙色风险提示；顶部突出时间范围和数据新鲜度；每个图表显示口径、更新时间和数据范围。移动端优先保证 KPI、筛选和列表可用，复杂图表允许横向滚动。

### 7.8 阶段拆分

#### 15A：统计契约与只读仓储

确定 DTO、时间范围、权限矩阵、金额格式、错误码和统计口径；实现本地 Schema analytics repository 与最小 API；补充 SQL 聚合和跨租户隔离测试。

#### 15B：生产 Analytics Adapter

基于生产只读审计结果实现 `production-analytics.ts`；对缺少订阅、退款、媒体或财务字段的指标返回明确状态；仅在 Schema 评审后添加生产索引或迁移。

#### 15C：租户 Analytics 页面

替换普通首页固定的“暂无数据”指标为真实 API；新增 `/analytics` 页面、筛选器、趋势、订单漏斗、频道排行和发布健康。

#### 15D：Super Admin Dashboard

新增平台管理员路由、平台聚合 API、审核积压、订阅收入、租户增长和运行健康模块；接入脱敏和只读审计。

#### 15E：快照与导出评估

根据真实查询耗时和数据量评估每日快照。CSV 导出作为后续功能，不放入首个可交付版本，避免绕过权限和大数据量下载风险。

### 7.9 主要风险与首个交付标准

- 收入重复计算：统一以确认流水为收入事实，订单金额只能作为应收指标。
- 生产表差异：所有生产查询进入 adapter；缺表时返回可识别状态，禁止静默显示 0。
- 时区边界：日期范围转换为 UTC 半开区间 `[from, to)`，SQL 使用 `>=` 与 `<`。
- 指标漂移：DTO 固定定义版本，改变统计口径时增加版本说明。
- 首个交付必须通过权限、跨租户隔离、金额来源、时间范围、空数据和 Schema 缺口测试；Dashboard 不使用固定演示数字。
- 在生产订阅表、退款表和真实 Cloudflare D1 验证完成前，不开放生产 Super Admin 的缺失指标。
