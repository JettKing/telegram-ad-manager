# 生产 D1 备份与恢复演练

## 自动备份

`.github/workflows/backup-production-d1.yml` 每天 UTC 18:17（北京时间 02:17）执行一次，也支持手动触发。流程会：

1. 使用 GitHub production environment 中的 Cloudflare 凭证导出 `tg-ad-manager` 生产 D1；
2. 用临时 SQLite 内存数据库执行恢复，检查 SQL 是否可执行、完整性是否为 `ok`，并确认关键表存在；
3. 将 SQL 文件上传为 GitHub Artifact，保留 30 天。

备份文件不会写入仓库，也不会在日志中输出 Cloudflare 或 Telegram 密钥。

## 恢复演练

`.github/workflows/restore-drill-production-d1.yml` 需要手动输入：

- 已成功完成的备份 workflow run ID；
- 精确输入 `RESTORE_DRILL`。

恢复演练只下载备份并恢复到临时 SQLite，不会执行生产 D1 写操作。演练成功只能证明 SQL 备份可被解析和恢复，不能替代真正的 Cloudflare D1 生产恢复审批。

## 生产恢复边界

真正生产恢复属于高影响操作，当前不由自动工作流直接执行。发生数据事故时，应先暂停写入和发布任务，确认目标时间点、备份 run ID、影响范围和回滚窗口，再由有权限的维护人员使用 Cloudflare D1 Time Travel 或受控的新数据库恢复方案执行，并在恢复后重新完成 API、登录、订单和发布队列验收。
