# PROJECT_STATUS

## 当前状态

阶段 6 已完成 CRM、套餐、订单和内容编辑器的代码基线，并通过本地门禁。业务 API 复用当前 Session 的 Tenant/Workspace/RBAC，上游资源在写入订单前重新做归属检查，不依赖前端传入金额或租户标识。

## 阶段 6 已实现

`apps/api/src/business.ts` 提供 CRM 客户校验、套餐参数校验、订单内容 JSON 校验、订单金额计算和订单状态迁移。客户支持联系人、Telegram 用户、来源、备注和状态；套餐支持广告类型、发布次数、展示/置顶/间隔、原价、折扣价、自动取消置顶、自动删除策略、启用和公开字段。

订单创建必须通过当前 Tenant/Workspace 找到客户、启用套餐、active 频道和 ready 媒体素材。订单金额来自套餐折扣价或原价，折扣金额只允许为非负整数且不能超过套餐应收；订单内容支持文本、实体和最多 20 个去重素材引用。订单创建和内容更新都会写 `ad_order_revisions`，素材引用写入 `ad_order_media_refs`。

订单状态通过显式迁移矩阵约束。当前提供草稿、提交付款、读取、内容编辑和通用状态迁移 API；不会允许把 draft 直接改成 published，也不会在客户端提交金额后直接信任。

## API

CRM：`GET/POST/PATCH /api/v1/customers`。套餐：`GET/POST /api/v1/packages`。订单：`GET/POST /api/v1/orders`、`GET /api/v1/orders/:orderId`、`PATCH /api/v1/orders/:orderId/content`、`POST /api/v1/orders/:orderId/submit` 和 `POST /api/v1/orders/:orderId/transition`。

## 检查证据

- `pnpm db:check`：通过，8 份 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，6 个测试文件，22 个测试。
- `pnpm build`：通过。
- 测试覆盖 CRM/套餐参数、编辑器去重和长度上限、订单状态迁移，以及全部前置阶段边界。

## 尚未完成

尚未在真实 Cloudflare D1 上执行 Migration 和事务联调。付款凭证审核、订单审批 UI、金额/支付流水、财务审计、排期、发布队列、Telegram 发布结果和库存/配额限制仍未完成。当前阶段没有声称订单已经支付或发布。

## 下一步

进入付款核账与排期发布：先增加付款凭证写入和 Finance 审核，再建立一次性/周期排期、幂等发布任务和 Telegram 发布结果记录。
