# API_SPEC

## 统一约定

所有业务接口使用 `/api/v1` 前缀。成功响应形如 `{ "ok": true, "data": ... }`；失败响应形如 `{ "ok": false, "error": { "code", "message", "details?", "requestId?" } }`。所有受保护接口从 Bearer Session 解析 Tenant/Workspace，不接受客户端传入的 tenant_id 来扩大查询范围。

## 当前已实现

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/health` | 进程存活探针 | 已实现 |
| GET | `/health/ready` | 必要依赖就绪探针 | 已实现 |
| GET | `/api/v1/health` | 统一响应的运行状态 | 已实现 |
| GET | `/api/v1/metadata` | 产品版本和外部集成配置状态 | 已实现 |
| POST | `/api/v1/auth/telegram` | 验证 initData、upsert 用户、创建默认租户/工作空间并签发 session | 已实现 |
| GET | `/api/v1/customers` | 当前 Tenant/Workspace CRM 客户列表 | 已实现 |
| POST/PATCH | `/api/v1/customers`、`/api/v1/customers/:customerId` | 创建或编辑客户 | 已实现 |
| GET/POST/PATCH | `/api/v1/packages`、`/api/v1/packages/:packageId` | 当前工作空间套餐列表、创建和编辑 | 已实现 |
| GET/POST | `/api/v1/orders` | 当前工作空间订单列表和创建 | 已实现 |
| GET | `/api/v1/orders/:orderId` | 读取租户隔离订单 | 已实现 |
| PATCH | `/api/v1/orders/:orderId/content` | 编辑文本、实体和素材引用 | 已实现 |
| POST | `/api/v1/orders/:orderId/submit` | `draft → pending_payment` | 已实现 |
| POST | `/api/v1/orders/:orderId/transition` | 通过服务端状态矩阵迁移订单 | 已实现 |
| GET | `/api/v1/media-assets` | 当前工作空间素材列表 | 已实现 |
| POST | `/webhooks/telegram` | 验证 Webhook、去重并接收媒体 | 已实现 |

## CRM 与套餐

客户写入使用 `customer:write`，读取使用 `customer:read`。套餐读取使用 `order:read`，创建使用 `order:write`。客户状态必须属于预定义集合；套餐金额使用整数 minor units，折扣价不能高于原价。

## 订单与编辑器

创建订单需要 `{ customerId, channelId, packageId, discountMinor?, content: { text?, entities?, assetIds? } }`。服务端会重新查询客户、启用套餐、active 频道和 ready 素材，并按照套餐折扣价/原价计算 amount 和 receivable。`discountMinor` 只允许非负整数且不能超过 amount，客户端不能提交 amount 或 receivable 覆盖服务端计算。

内容编辑最多 4096 个字符、20 个去重素材引用和 100 个实体项。草稿或待付款订单才允许编辑。订单状态使用服务端迁移矩阵；状态变化和内容变化写入 `ad_order_revisions`，素材引用写入 `ad_order_media_refs`。

## 尚未开放的接口边界

付款凭证、Finance 审核、退款流水、排期、发布任务、Telegram 发布、到期处理、订阅、统计和管理员接口仍按阶段清单逐步实现。
