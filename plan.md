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
