# PROJECT_STATUS

## 当前状态

阶段 8 已完成排期、发布任务队列、Telegram 发布适配和到期处理的代码基线，并通过本地门禁。当前实现使用 D1 任务表作为队列存储，由 Workers scheduled handler 周期 claim 到期任务；没有声称已经配置 Cloudflare Queues 或真实 Cron。

## 已实现

`apps/api/src/publishing.ts` 提供排期输入校验、D1 排期仓储、任务幂等 claim、任务 payload 装载、成功/失败日志、指数退避和到期任务查询。只有 approved 订单可以创建排期；排期会写 `ad_schedules`、`ad_publish_tasks`，任务 idempotency key 为 `schedule:<scheduleId>`。

`TelegramBotApiClient` 新增 sendMessage、sendPhoto、sendVideo、sendDocument、deleteMessage、pinChatMessage 和 unpinChatMessage。`TelegramPublisher` 根据订单内容和素材类型发布 Telegram 消息，保存最后一个成功 message_id；429 使用 Telegram `retry_after`，网络或服务错误使用指数退避，永久 API 错误不会无限重试。

任务成功后订单进入 published，失败达到 max_attempts 后进入 failed 或 uncertain。到期处理查询已发布且 `planned_end_at <= now` 的订单，调用 Telegram deleteMessage；删除成功后订单进入 completed，并写发布日志。

Workers 入口新增 scheduled handler，调用 `processDuePublishTasks`，单次最多处理 10 个到期队列任务并处理到期删除。

## API

- `GET /api/v1/schedules`：读取当前工作空间排期。
- `GET /api/v1/publish-tasks`：读取当前工作空间发布任务。
- `POST /api/v1/orders/:orderId/schedules`：创建排期并入队。

排期读取使用 `publish:read`，排期创建使用 `publish:write`。所有业务查询按 Tenant/Workspace 过滤。

## 检查证据

- `pnpm db:check`：通过，10 份 Migration 连续有效。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，8 个测试文件、30 个测试。
- `pnpm build`：通过。
- 开发 API metadata 阶段为 `scheduling-publish-expiration`。

## 尚未完成

尚未执行真实 Cloudflare D1 Migration、Workers Cron、Queues、Telegram Bot 发布和 deleteMessage 外部联调。当前 claim 采用 D1 条件更新，真实并发、任务恢复和非幂等 Telegram 请求需要生产验证。多消息发布、pin/edit/delete 策略和媒体组原子发布仍需后续增强。
