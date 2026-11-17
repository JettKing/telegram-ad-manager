# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 6 CRM、套餐、订单与编辑器

实现 `apps/api/src/business.ts` 和业务 API。CRM 支持客户创建、列表和编辑；套餐支持价格、折扣、发布次数、展示/置顶/间隔和自动处理策略；订单创建前严格验证客户、启用套餐、active 频道和 ready 素材均属于当前 Tenant/Workspace。

订单金额由服务端根据套餐价计算，discount_minor 仅允许非负整数且不能超过 amount。订单内容编辑器限制文本、实体和素材引用数量；素材引用写入 `ad_order_media_refs`，订单创建、内容修改和状态变化写入 `ad_order_revisions`。状态迁移矩阵阻止 draft 直接发布。

新增 `0008_business_editor.sql`，增加订单素材引用表和 CRM/套餐/修订查询索引。阶段门禁通过 8 份 Migration、22 个测试、类型、Lint 和生产构建。真实 D1、付款、排期和发布仍未联调。

## 2026-11-17 — 阶段 5 多媒体素材与相册聚合

实现媒体解析、素材幂等和相册状态机。

## 2026-11-17 — 阶段 4 频道绑定与 Telegram 权限检查

实现频道身份、管理员权限快照、绑定、复核和软解绑。

## 2026-11-17 — 阶段 3 用户、平台会话与 RBAC

实现用户 upsert、默认租户/工作空间、可撤销 HMAC Bearer Session 和后端 RBAC middleware。
