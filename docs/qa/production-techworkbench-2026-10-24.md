# Stars 科技工作台公网发布与验收

日期：2026-10-24。公网入口：[https://39.107.41.101/](https://39.107.41.101/)。本报告仅对应代码提交 `94ec577eada346b49b826f5ec47fa1276cc71408` 和服务器 release `/opt/stars-demo-releases/20261024T123111Z-techworkbench-94ec577`。后续文档提交不改变该已部署代码版本。

## 发布范围与隔离

- 从既有 GitHub 仓库拉取上述提交，在独立 release 目录运行 `npm ci` 和 `npm run build`，将 `/opt/stars-demo-release` 原子切换到新版。旧版 `20261024T093929Z-workbench` 保留供回滚；发布临时源码 clone 已确认与运行 release 分离后清理。
- 切换前运行中的生成任务为 0。仅重启 `stars-demo.service`，切换后服务 `active/running`、PID `93710`；不重启 MySQL、Docker 或 Firestone，不修改或 reload Nginx。Nginx 配置哈希前后一致，Firestone 本机探针为 200，其容器和 MySQL 启动时间未变化。
- 新旧 `.env` 哈希一致，权限保持 `0600 root:root`；未输出或提交环境变量值。云 MySQL 延用已迁移的 002/003/004，本次无 schema 迁移。
- Stars 专属加密备份创建成功：`/var/backups/stars-demo/stars-20261024T123224Z-a342cae1.sql.enc`；新版备份脚本 `--check` 通过。此处未重复执行密钥恢复演练。

## 公网核验

| 检查 | 结果 |
| --- | --- |
| HTTPS 首页 | `https://39.107.41.101/` 返回 200；TLS 正常 |
| HTTP 入口 | 返回 301，指向同一 IP 的 HTTPS |
| 健康检查 | `/api/health` 返回 `ok=true`、`storage=mysql`、`stubModel=false` |
| 匿名权限 | 未登录项目和文件夹 API 返回 401 |
| 构建产物 | 公网 HTML、JS、CSS 的 SHA-256 与本地本轮构建一致；旧版 hashed assets 保留以照顾已有浏览器缓存 |
| 公网浏览器只读验收 | 在真实公网 bundle 中仅拦截 `/api/me`、项目与文件夹 GET 以合成登录态；375/768/1280 px 下附件菜单没有溢出，本地文件及嵌套文件夹可选择、显示相对路径和移除；文件夹选择、新建与重命名弹层正常。两轮无页面异常，且未向生产 API 发出写请求 |

公网浏览器的合成登录态只验证已部署前端交互，不证明真实账号登录、生产 MySQL 写入或生成链路。本轮部署前的本地完整 Playwright、API 22/22、lint、typecheck、format:check 和 build 见 [附件与主题回归](workbench-attachments-2026-10-24.md)；前批公网 MySQL 10 项烟测见 [旧版生产验收](production-workbench-2026-10-24.md)。这些证据互不替代。

## 未复测与后续

- 本次未调用真实模型，未执行生产注册或邮件投递，未复测真实麦克风。服务器尚未配置 Cloudflare Turnstile 站点与密钥，因此真实挑战未启用或验收；隔离环境的一次性 token 回归不等于 Cloudflare 服务验收。
- 仍需监控模型额度与短期 IP 证书续期，完成备份密钥恢复演练和生产凭据轮换。若发现本版故障，先确认迁移兼容性，再把 `/opt/stars-demo-release` 切回保留的上一 release，仅重启 Stars 服务；不得删除业务数据或干扰同机项目。
