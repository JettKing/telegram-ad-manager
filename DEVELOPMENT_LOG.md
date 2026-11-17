# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 2 Telegram 认证与 Webhook（实现中）

核对 Telegram 官方 Mini Apps、Bot API 和 Webhook 指南后，实现了真实的 Mini App initData HMAC-SHA256 校验。校验包含字段排序、`WebAppData` 派生密钥、hash 常量时间比较、auth_date 新鲜度、用户 JSON 解析和基于 raw initData hash 的 replay store。实现了 `/api/v1/auth/telegram`。

实现了 `/webhooks/telegram`，包括 `X-Telegram-Bot-Api-Secret-Token` 校验、Update 结构验证、`update_id` 去重、D1 持久化接口和开发内存实现。新增 `0004_telegram_security.sql` 保存 Webhook 日志与 initData replay 记录。

本阶段尚未完成用户 upsert、平台会话、Webhook 队列消费者，也尚未配置真实 Bot Token、Webhook Secret 和公开 HTTPS URL。门禁结果将在测试完成后更新。

## 2026-11-17 — 阶段 1 基线

完成项目从空目录初始化；建立 React/Vite 前端与 Hono API 包边界、共享契约、D1/SQLite Migration、前端路由清单、移动端响应式工作台、健康探针、Workers 入口及基础文档。阶段 1 的 db:check、typecheck、lint、test、build 和 HTTP 探针检查均已通过。
