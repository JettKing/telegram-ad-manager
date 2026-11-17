# DEVELOPMENT_LOG

## 2026-11-17 — 阶段 8 排期、Telegram 发布队列与到期处理

新增 `apps/api/src/publishing.ts` 和 `0010_publish_queue.sql`。approved 订单才能创建排期；排期创建同时写入 D1 任务和 `schedule:<scheduleId>` 幂等键。任务 claim 通过 queued 条件更新进入 processing，成功写发布日志和 message_id，失败按 Telegram 429 retry_after 或指数退避处理。

Telegram client 新增文本、图片、视频、文档发送和消息删除/置顶能力。Workers scheduled handler 调用队列处理器和到期处理器；published 订单达到 planned_end_at 后尝试 deleteMessage，成功同步 completed。

阶段门禁通过 10 份 Migration、30 个测试、类型、Lint 和生产构建。真实 D1、Workers Cron、Queues、Telegram Bot 发布、非幂等恢复和多消息发布仍未联调。

## 2026-11-17 — 阶段 7 付款凭证、Finance 审核与退款流水

实现付款凭证引用、Finance 审核和退款流水。

## 2026-11-17 — 阶段 6 CRM、套餐、订单与编辑器

实现客户、套餐、订单、内容编辑器和素材引用。
