# CRM、套餐、订单与编辑器

阶段 6 使用既有 `customers`、`ad_packages`、`ad_orders` 和 `ad_order_revisions` 表，并通过 `0008_business_editor.sql` 增加 `ad_order_media_refs`。CRM 和套餐所有读写都带 Tenant/Workspace 条件。

创建订单时，服务端重新查询客户、启用套餐、active 频道和 ready 素材。订单金额使用套餐折扣价或原价，再减去非负的 `discountMinor`。客户端不能传入 amount、receivable 或其他租户标识来覆盖服务端计算。

编辑器内容结构为 `{ text, entities, assetIds }`。文本最多 4096 个字符，素材引用最多 20 个并去重，实体最多 100 个。订单处于 draft 或 pending_payment 时允许编辑；每次编辑写修订记录并同步订单素材引用。

订单状态迁移由服务端矩阵控制。当前可从 draft 提交到 pending_payment，其他状态必须遵守显式迁移集合。该阶段没有实现付款核账、排期、发布或退款流程，因此订单不会被接口伪装成已支付或已发布。
