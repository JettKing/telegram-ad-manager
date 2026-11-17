# REQUIREMENTS

TG Ad Manager V1.1 必须成为可部署、可运营、可收费、可扩展的 Telegram 广告管理 SaaS，而不是静态页面。核心用户包括频道主、广告运营者、代理商和平台超级管理员。

首发产品由公共 Telegram Bot、Telegram Mini App 和 Web 管理后台组成；三者共享后端业务逻辑和数据库。系统必须使用 Telegram Mini App initData 验签、Webhook Secret Token、服务端权限控制、多租户隔离、Migration、可重试/可恢复队列和审计记录。核心业务覆盖多频道绑定、多媒体素材、客户 CRM、套餐、订单、付款核账、编辑器、排期、真实 Telegram 发布、到期处理、人工财务、FREE/PRO/BUSINESS 订阅、通知、统计和超级管理员。

优先采用 React/TypeScript/Vite/Tailwind 与 Hono/Workers/D1/Queues/Cron；Telegram 原生 file_id 是默认素材存储方式，R2 仅为可选归档。订单首发优先人工创建和人工确认付款；自助下单、支付平台、白标和代理商模式预留扩展。

所有未配置外部密钥、账号、频道权限或实际部署环境的能力都必须单独标记为待配置/待验证，禁止把本地测试、固定数据或模拟成功响应写成真实外部集成结果。
