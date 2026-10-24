# Stars 工作台生产发布与烟测（2026-10-24）

地址：[https://39.107.41.101/](https://39.107.41.101/)。本报告记录前批文件夹、附件/语音入口、账户菜单及关联导航交互的公网 HTTPS 与云 MySQL 验证；当时没有重复调用真实模型或发送验证码邮件。当前科技主题与文件/目录附件菜单的后续发布见 [新版记录](production-techworkbench-2026-10-24.md)。

## 发布与隔离范围

| 项目 | 本批结果 |
| --- | --- |
| 本批当时 release | `/opt/stars-demo-releases/20261024T093929Z-workbench`，当时由 `/opt/stars-demo-release` 指向；现保留为回滚版 |
| 回滚保留 | `/opt/stars-demo-releases/20261024-email-verification` 保留，未删除 |
| 服务 | 仅重启 `stars-demo.service`，PID `89662 → 92536`；继续只监听 `127.0.0.1:8787` |
| Nginx | 本批未修改配置、未 reload；3 个关键配置哈希与发布前一致，沿用现有 Stars HTTPS 与代理配置 |
| 其他项目 | 最终 Firestone `127.0.0.1:18573` 仍返回 200，代理 PID `83060` 未变；两个 Firestone 容器及 MySQL 的启动时间保持发布前值，均运行中 |
| 数据库 | `003_email_verifications.sql` 已存在；本批在 `stars_demo_workbench` 补齐 `004_folders.sql`，应用账号对新表的读取探针通过，运行账号不承担 DDL |
| 静态资源 | 公网 HTML 引用 `index-Bq_JszDV.js`、`index-qxlsVSP-.css` |
| 可达性 | HTTPS 返回 200，HTTP 返回 301；健康状态为 `storage=mysql`、`stubModel=false` |
| 发布一致性 | 全部 22 个发布文件哈希与本地归档一致，运行配置与旧 release 字节一致；上传临时文件已移除 |

本次检查发现旧邮箱验证码 release 未包含 `deploy/backup_stars.py`，导致原备份服务运行失败。部署前使用该脚本的临时副本生成加密备份 `/var/backups/stars-demo/stars-20261024T094108Z-135edae4.sql.enc`。新 release 纳入该脚本后，再执行 `systemctl start stars-demo-backup`，服务成功且退出码为 0。本批未重复执行解密恢复演练；此前隔离恢复证据保留在 [历史生产验收](production-acceptance-2026-10-24.md)。部署、归档哈希和最终隔离复核证据见 [deployment-report.json](../../stars-demo/test-results/production-workbench-2026-10-24/deployment-report.json)。

## 公网 Playwright 结果

`test/workbench_production_smoke.py` 执行完成并以 0 退出，输出 `Production workbench smoke passed`。[report.json](../../stars-demo/test-results/production-workbench-2026-10-24/report.json) 记录时间为 `2026-10-24T09:48:46Z`，结果 `passed`、阶段 `complete`，10 项检查通过。

| 检查 | 结果与边界 |
| --- | --- |
| HTTPS 与健康状态 | 有效 HTTPS、MySQL 可用、Stub 关闭 |
| 匿名访问 | 文件夹与项目接口拒绝匿名请求，返回 401 |
| 正常界面登录 | 通过登录界面建立会话，验证安全 Cookie；没有通过注册接口创建账号 |
| 文件夹与归类 | 创建、重命名及项目归类写入云 MySQL，刷新后保留 |
| 最近与全部 | 最近视图显示 8 项，切回全部显示 9 项，筛选被正确清除 |
| 附件与语音入口 | 选择/移除文本附件，验证语音入口；不进行真实麦克风转写 |
| 独立新建 | 清除当前项目上下文，保留所选文件夹；只进入规则式规划，不提交生成 |
| 用户隔离 | 第二账号访问他人项目或文件夹返回 404 |
| 移动工作台 | 375px 无横向溢出，文件夹与账户入口可用；删除文件夹后项目变为未分类 |
| 退出与副作用 | 两个账号通过界面退出，`/api/me` 返回 401；没有生成或邮件请求 |

报告记录 `realModelCalls=0`、`blockedRequests=[]`、`browserErrorCount=0`。本地测试的 Stub、邮件捕获和模拟语音证据与此公网 MySQL 烟测分开，见 [登录后工作台回归](logged-in-workbench-2026-10-24.md)。

截图：[桌面文件夹工作台](../../stars-demo/test-results/production-workbench-2026-10-24/desktop-folder.png)、[375px 移动工作台](../../stars-demo/test-results/production-workbench-2026-10-24/mobile-workbench.png)。

## 测试数据与未验证范围

烟测使用两个独立临时账号，报告记录创建 10 个测试项目和 2 个测试文件夹。验收后按本批两个临时账号的 UUID 与合成邮箱精确清理，并级联移除其项目、会话、文件夹和临时计划。剩余合成账号为 0；数据库恢复发布前计数 `users=3`、`projects=1`，`folders=0`、`projectFolders=0`，未删除其他用户或其他项目数据。工作区外私有测试状态已删除，最终 Stars PID `92536` 为 `active/running`。

- 本批没有真实模型调用；此前 Qwen 生成、文件审核和预览证据仍属于历史批次。
- 本批未验证真实 SMTP 投递、Cloudflare Turnstile、真实麦克风或语音服务质量；没有发送验证码请求。
- 本批未修改 Nginx、其他项目配置或扩展应用权限；附件文本仍遵守现有需求持久化、模型输入和预览隔离边界。
- 管理凭据轮换、备份密钥恢复演练、持续证书/额度监控及更严格预览出口隔离仍属于后续运维事项；不在报告中记录凭据。
