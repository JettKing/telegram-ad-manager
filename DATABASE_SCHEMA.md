# DATABASE_SCHEMA

## 数据库边界

首发目标数据库是 Cloudflare D1，Migration 使用 SQLite 兼容 SQL。每个租户拥有的数据表都包含 `tenant_id`，后端查询必须从已验证的会话上下文得到租户，而不是信任前端传入的 `tenant_id`。密钥只保存为 Secret 引用，不写入数据库日志或 API 响应。

当前工程包含三份有序 Migration：`0001_core.sql` 建立 users、tenants、tenant_members、workspaces、workspace_members、sessions、Telegram Bot/频道/update、权限检查和 audit_logs；`0002_ad_business.sql` 建立 customers、tags、packages、media、orders、payments、schedules、publish tasks/logs；`0003_platform_operations.sql` 建立 subscription plans/entitlements/subscriptions/events、financial transactions、notifications、system jobs 和 system settings。

## 关键约束

所有金额使用最小货币单位整数 `*_minor`，时间使用 ISO 8601 UTC 字符串；枚举值由数据库 CHECK 约束和服务端状态机共同限制。订单、发布任务、财务流水和审计记录不允许通过普通删除级联消失。发布和系统任务都有唯一 `idempotency_key`、attempts、max_attempts、next_attempt_at 和失败信息。

## 迁移执行

运行 `pnpm db:check` 只验证文件编号连续、SQL 文件存在结构语句；它不声称已连接或执行目标 D1。部署阶段必须使用 Cloudflare Wrangler 对绑定的 D1 执行迁移，并将实际命令、数据库名称、结果和回滚方案补写到 `DEPLOYMENT.md` 与 `TEST_REPORT.md`。
