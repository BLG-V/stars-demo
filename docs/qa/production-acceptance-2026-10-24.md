# Stars 生产发布与验收记录

日期：2026-10-24  
地址：[https://39.107.41.101/](https://39.107.41.101/)

## 发布边界

- 发布目录：`/opt/stars-demo-release` 指向 `/opt/stars-demo-releases/20261024-audit`；上一版本保留在 `/opt/stars-demo-releases/pre-20261024-audit`。
- 只重启了 `stars-demo.service`，没有重启 MySQL、Docker 或其他项目。Stars 继续监听 `127.0.0.1:8787`。
- Firestone 项目仍使用 `127.0.0.1:18573`，其 Nginx 配置哈希与发布前一致；容器状态未受影响。
- `002_run_states.sql` 已在 `stars_demo_workbench` 执行。运行账号实际授权为该库 `SELECT, INSERT, UPDATE, DELETE`，无 DDL；对 `run_states` 的读、插入、更新和回滚事务探针通过。
- Stars 服务资源 drop-in 已启用：`MemoryMax=512M`、`CPUQuota=50%`、`TasksMax=64`、`LimitNOFILE=2048`。公网健康检查返回 `storage=mysql`、`stubModel=false`。
- Nginx 通过语法检查并仅 reload；Stars API 路由增加 HTTP API 跳转、登录/API 限流及 SSE 代理超时设置。

## 真实模型验收

使用唯一临时账号和项目运行 `test/production_acceptance.py`。第一次尝试只因主题 CSS 改变了 heading 的可访问名称而在计划确认选择器超时，未提交模型运行；复用同一项目后完成一次真实调用，未自动重试或重复收费。

真实 `qwen3.8-flash` 验收通过：

- 生成前计划确认；候选文件在批准前未写入项目；刷新后审核状态恢复。
- 批准写入、重复批准幂等、预览按钮交互、版本差异、保护版本恢复和响应式视口通过。
- 权限检查通过：匿名请求返回 401，第二账号读取测试项目返回 404。
- 生成文件为 `index.html`、`styles.css`、`app.js`。文件哈希记录在本地 [run-report.json](../../stars-demo/test-results/production-2026-10-24/run-report.json)；报告不含 API Key、密码或 Cookie。
- 仅一个不同的 `planId` 调用了模型。测试生成的项目、用户、会话及其运行记录已按精确 ID 清理。

服务重启后再次使用同一会话执行 verify：文件哈希、会话、运行历史和预览均恢复，且模型调用数为零。结果见 [verify-report.json](../../stars-demo/test-results/production-2026-10-24/verify-report.json)。截图包括 [生产工作台](../../stars-demo/test-results/production-2026-10-24/production-workbench.png)、[候选审核](../../stars-demo/test-results/production-2026-10-24/candidate-review.png) 和 [移动端版本差异](../../stars-demo/test-results/production-2026-10-24/snapshot-diff-mobile.png)。

## 备份与恢复

- 已部署 Stars 专用加密备份服务和每日 timer。备份目录 `/var/backups/stars-demo` 为 root-only，密钥 `/etc/stars-demo/backup.key` 为 root-only，保留规则只匹配 Stars 文件并保留七天。
- 发布前和发布后均创建加密备份；备份服务首次运行成功。
- 将发布后备份解密到唯一临时 schema，导入后比较关键表行数：`projects=2`、`project_files=7`、`agent_runs=3`、`run_states=2`、`snapshots=2`，与生产一致；随后删除临时 schema。没有覆盖生产库或其他项目数据库。
- 备份脚本使用 AES-256-CBC + PBKDF2。密钥必须独立保管；CBC 不提供认证篡改检测，恢复前应校验文件哈希并在隔离 schema 验证。

## 未关闭事项

- 对话中暴露的服务器 root 和数据库管理凭据未在本次发布中轮换，因为该主机还有其他项目；轮换必须先建立各项目独立的恢复访问路径。
- 严格零外联预览仍需要浏览器或网络出口隔离；CSP 和静态 URL 检查不构成完整出口保证。
- 远程 CI 未执行；备份密钥恢复流程、限流阈值和资源上限需要持续监控；未增加生成代码服务器命令执行权限。
