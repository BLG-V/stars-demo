# Stars 生产发布与验收记录

日期：2026-10-24  
地址：[https://39.107.41.101/](https://39.107.41.101/)

## 前批工作台发布记录

当时的 release 为 `/opt/stars-demo-releases/20261024T093929Z-workbench`，旧邮箱验证码 release 保留。已补齐云库 `004_folders.sql` 并只重启 Stars；本批 Nginx 未修改、未 reload，Firestone 检查仍返回 200。本批公网 Playwright 10 项工作台烟测通过，真实模型调用为 0、浏览器错误为 0；未复测真实 SMTP、Cloudflare 或麦克风。发布、备份修复、测试数据清理状态及产物见 [工作台生产验收](production-workbench-2026-10-24.md)。当前科技主题与文件/目录附件菜单已另行发布，见 [新版发布记录](production-techworkbench-2026-10-24.md)。

## 以下为历史审计修复与邮箱验证码发布记录

以下源码、release、Nginx reload、真实模型和隔离恢复证据保留原批次含义；不将其作为本批重新执行的验收。

源码基线：GitHub `BLG-V/stars-demo`，`master` 提交 `32fbafafd091ff06d86a9112d9611a6e45801457`。服务器新版 release 的 `server/index.mjs`、`package.json` 和 `dist/index.html` SHA-256 与该提交对应文件一致。

邮箱验证码补丁已部署到 `/opt/stars-demo-releases/20261024-email-verification`，仅重启 `stars-demo.service`；`003_email_verifications.sql` 已应用到 Stars 云库。SMTP 使用服务端环境变量注入，公网请求验证码返回 202，错误验证码返回 `400 REGISTRATION_ERROR`。SMTP 密码不记录在文档或日志中。

2026-10-24 视觉更新仅替换该 release 的静态 `dist`：暖色亮色登录后工作台，以及按 Atoms `/zh` 公开页复刻的 Stars 未登录导航、Hero Composer、能力卡、Agents、统计、FAQ 和页脚；API 进程未重启，公网 HTML 已引用最新 Vite CSS/JS 哈希资源。

随后同步未登录公开态：公网首屏隐藏登录后导航与项目区，采用 Atoms 风格的浅色单画布、菜单入口、Agent 头像组、主标题和 Composer；登录后仍进入完整 Stars 工作台。

## 发布边界（历史审计批次）

- 发布目录：`/opt/stars-demo-release` 指向 `/opt/stars-demo-releases/20261024-audit`；上一版本保留在 `/opt/stars-demo-releases/pre-20261024-audit`。
- 只重启了 `stars-demo.service`，没有重启 MySQL、Docker 或其他项目。Stars 继续监听 `127.0.0.1:8787`。
- Firestone 项目仍使用 `127.0.0.1:18573`，其 Nginx 配置哈希与发布前一致；容器状态未受影响。
- `002_run_states.sql` 已在 `stars_demo_workbench` 执行。运行账号实际授权为该库 `SELECT, INSERT, UPDATE, DELETE`，无 DDL；对 `run_states` 的读、插入、更新和回滚事务探针通过。
- Stars 服务资源 drop-in 已启用：`MemoryMax=512M`、`CPUQuota=50%`、`TasksMax=64`、`LimitNOFILE=2048`。公网健康检查返回 `storage=mysql`、`stubModel=false`。
- Nginx 通过语法检查并仅 reload；Stars API 路由增加 HTTP API 跳转、登录/API 限流及 SSE 代理超时设置。

## 真实模型验收（历史审计批次）

使用唯一临时账号和项目运行 `test/production_acceptance.py`。第一次尝试只因主题 CSS 改变了 heading 的可访问名称而在计划确认选择器超时，未提交模型运行；复用同一项目后完成一次真实调用，未自动重试或重复收费。

真实 `qwen3.8-flash` 验收通过：

- 生成前计划确认；候选文件在批准前未写入项目；刷新后审核状态恢复。
- 批准写入、重复批准幂等、预览按钮交互、版本差异、保护版本恢复和响应式视口通过。
- 权限检查通过：匿名请求返回 401，第二账号读取测试项目返回 404。
- 生成文件为 `index.html`、`styles.css`、`app.js`。文件哈希记录在本地 [run-report.json](../../stars-demo/test-results/production-2026-10-24/run-report.json)；报告不含 API Key、密码或 Cookie。
- 仅一个不同的 `planId` 调用了模型。测试生成的项目、用户、会话及其运行记录已按精确 ID 清理。

服务重启后再次使用同一会话执行 verify：文件哈希、会话、运行历史和预览均恢复，且模型调用数为零。结果见 [verify-report.json](../../stars-demo/test-results/production-2026-10-24/verify-report.json)。截图包括 [生产工作台](../../stars-demo/test-results/production-2026-10-24/production-workbench.png)、[候选审核](../../stars-demo/test-results/production-2026-10-24/candidate-review.png) 和 [移动端版本差异](../../stars-demo/test-results/production-2026-10-24/snapshot-diff-mobile.png)。

## 备份与恢复（历史审计批次）

- 已部署 Stars 专用加密备份服务和每日 timer。备份目录 `/var/backups/stars-demo` 为 root-only，密钥 `/etc/stars-demo/backup.key` 为 root-only，保留规则只匹配 Stars 文件并保留七天。
- 发布前和发布后均创建加密备份；备份服务首次运行成功。
- 将发布后备份解密到唯一临时 schema，导入后比较关键表行数：`projects=2`、`project_files=7`、`agent_runs=3`、`run_states=2`、`snapshots=2`，与生产一致；随后删除临时 schema。没有覆盖生产库或其他项目数据库。
- 备份脚本使用 AES-256-CBC + PBKDF2。密钥必须独立保管；CBC 不提供认证篡改检测，恢复前应校验文件哈希并在隔离 schema 验证。

## 未关闭事项

- 对话中暴露的服务器 root 和数据库管理凭据未在本次发布中轮换，因为该主机还有其他项目；轮换必须先建立各项目独立的恢复访问路径。
- 严格零外联预览仍需要浏览器或网络出口隔离；CSP 和静态 URL 检查不构成完整出口保证。
- 远程 CI 未执行；备份密钥恢复流程、限流阈值和资源上限需要持续监控；未增加生成代码服务器命令执行权限。
