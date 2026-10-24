# Stars 阶段 1–4 验收清单

清单中的“通过”必须有测试结果或可复核操作。本轮修复已于 2026-10-24 部署并完成生产复核；旧版记录仍单独标注为历史证据。

## 当前基线（2026-10-23，本地审计修复）

| 阶段 | 本轮本地结果 | 未关闭项 |
| --- | --- | --- |
| 阶段 1 项目骨架 | 锁定依赖、ESLint、限定范围 strict checkJs、Prettier、统一测试脚本和 CI 文件已加入；本地检查通过 | 远端 CI 尚未执行；全应用严格类型检查和源码格式检查不在当前覆盖范围 |
| 阶段 2 数据与身份 | JSON/MySQL 运行状态持久化、迁移 `002_run_states.sql`、审批事务和中断状态已有本地/API 或 fake pool 测试 | 生产迁移、审批链、加密备份隔离恢复和跨用户浏览器矩阵已通过 |
| 阶段 3 工作台 | 计划确认、候选差异审核、消息/运行历史、快照内容差异、应用内对话框、禁用入口和真实空状态已接入；既有扩展 Playwright 通过 | 运行中刷新恢复与延迟模型回归已通过；最终全套本地门禁已通过；取消及更广泛可访问性检查待做 |
| 阶段 4 模型与编排 | `planId` 幂等、持久化事件重放、基线哈希保护、审核批准/拒绝、启动中断标记已实现 | 真实 Qwen3.8-flash 单计划已通过；完整工具执行授权和多实例 worker 不在已验收范围 |

审计补充修复后，本地 19 项 API/存储测试、扩展 Playwright、lint、限定范围 typecheck、format:check 和 build 全部通过；两份 Python 验收脚本通过语法检查。线上三文件 Qwen 验收属于此前版本。

## 阶段 1：项目骨架与质量门禁

- [x] 提供 `dev`、`build`、`lint`、`typecheck`、`test`、`test:e2e`、`format:check`；`npm test` 执行语法与 API/存储测试。
- [x] 前端为 Vite + React，服务端为独立 Node HTTP API；不将 Next.js 或 TypeScript 迁移当作已实现事实。
- [x] `.env.example` 只含变量名/说明，`.gitignore` 排除运行凭据、依赖、构建产物和本地数据。
- [x] ESLint 覆盖应用、服务和 JavaScript 测试；依赖版本与 lockfile 已固定。
- [x] strict checkJs 仅覆盖 `server/schemas.mjs`、`vite.config.js`、`eslint.config.js`；Zod 在运行时校验身份、计划和运行输入。
- [x] Prettier 只检查包文件、工具配置、部署说明和 CI；未对全部应用源码实施格式门禁。
- [x] `.github/workflows/stars-ci.yml` 定义安装、lint、typecheck、format、测试、构建和 Playwright。
- [ ] 在远端 CI 的干净环境运行并留存结果；不能用“已有 workflow”替代 CI 通过证据。
- [ ] 扩大全应用类型/schema 覆盖及源码格式检查（若继续列为完整质量门禁，须单独验收）。

本轮本地通过的命令：

```powershell
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
npm run test:e2e
```

## 阶段 2：数据、身份和运行恢复

- [x] `001_initial.sql` 定义原有八张业务表；本轮 `002_run_states.sql` 增加 `run_states(run_id,payload)`，保存计划、候选文件、基线哈希和事件。
- [x] JSON 与 MySQL adapters 支持运行状态保存、运行认领、审批提交和启动中断处理；MySQL 查询使用参数化语句和事务。
- [x] 运行/计划/审批按服务端会话校验项目 owner；不信任客户端所有者字段；无权资源返回不可枚举的 404。
- [x] 密码使用 Node `scrypt`，会话 token 只保存 SHA-256 摘要；接口不返回秘密。
- [x] 生产注册已完成真实邮箱验证码发送链路验收；SMTP 凭据只注入服务端，验证码哈希、过期、单次消费和尝试限制已通过 API/本地浏览器回归，公网请求验证码返回 202，错误验证码被拒绝。
- [x] 本地测试覆盖计划幂等、事件重放、审核拒绝/批准、基线哈希过期保护及原文件保留。
- [x] 单 API 进程启动时把遗留 `running` 标为 `RUN_INTERRUPTED` 并保存错误事件；待审核候选保留，不声称自动续跑模型或多实例恢复。
- [ ] 在生产由迁移身份执行 002，复核运行账号业务读写权限及新审批事务。生产应用继续使用 `STARS_SKIP_MIGRATIONS=true`，不授予 DDL。
- [x] 完成生产备份恢复演练、生产快照恢复及跨用户浏览器矩阵；密钥恢复演练仍待完成。
- [ ] 完成密码参数、限流、会话策略及凭据轮换安全复核。

## 阶段 3：工作台与浏览器回归

- [x] 空项目不预填生成文件或成功预览；没有真实计费时只显示“暂未启用积分计费”。
- [x] 附件、语音和文件夹管理明确禁用；未配置连接器不暗示授权成功。
- [x] 生成前展示服务端保存的规则式执行范围和文件计划，用户确认后才调用模型。
- [x] 候选文件生成后显示新增/修改/删除及内容差异；批准前不替换项目文件，拒绝时保留原内容。
- [x] 显示持久化消息、运行状态、错误码及可折叠事件；刷新恢复待审核候选和项目历史。
- [x] 项目重命名、删除和恢复使用应用内对话框；快照可查看内容差异，恢复前保存保护版本。
- [x] 扩展 Playwright 覆盖计划与文件两次确认、审核拒绝、历史恢复、快照差异、禁用入口、空状态、像素样式与预览真实交互。
- [x] 浏览器回归检查响应式视口、预览按钮变化和项目刷新恢复；本地使用隔离 JSON 数据与明确的 Stub。
- [x] 延迟本地 mock 回归确认运行中刷新后以同一 `planId`、`Last-Event-ID >= 3` 重连，自动进入候选审核，供应商请求恰好一次。
- [x] 预览监控使用 IIFE；生成应用声明 `report`/`original` 等全局名称仍可交互，避免监控代码变量碰撞。
- [ ] 运行取消、完整键盘/读屏及更多浏览器兼容性验收。

## 阶段 4：模型、事件和安全边界

- [x] `POST /api/projects/:id/plans` 保存计划；`POST .../runs` 必须提交 `{planId,idempotencyKey:planId}`。
- [x] 同一计划不会重复调用模型；持久化事件按递增 ID 保存，重复请求可用 `Last-Event-ID` 重放；前端已实现同计划的有限自动重连/刷新恢复，观察上限 240 秒，连续网络失败受限；HTTP 错误直接停止。
- [x] 实际事件为 `queued/planning/read_file/generating/validating/file_change/review/done/error`；`read_file` 只在有当前文件时出现，`done` 只在批准提交后保存。
- [x] `approve` 校验原文件指纹再原子提交；`reject` 丢弃候选；过期计划/审核不覆盖新文件。
- [x] Provider 和手动文件保存共用 `unsafeContent`：归一化 HTML 实体、百分号、JavaScript 转义、TAB/CR/LF 和反斜杠，拒绝显式 `http(s):`、外链（含编码 IP、IPv6、localhost）和 Atoms 品牌文本；模型输出与手动保存的绕过回归先复现失败、修复后通过。
- [x] 生成文件校验路径/扩展名、重复路径、数量和大小；Provider 错误、无效 JSON、超时与危险输出均有本地测试。
- [x] 未配置模型默认返回明确错误；Stub 仅在显式开发开关启用，UI 不把它冒充真实模型结果。
- [x] 请求日志输出结构化 JSON：request ID、状态、耗时、项目/运行 ID、`runStatus` 和模型错误码；客户端断开仍写 `run_finished`，测试已验证。错误响应含 requestId，不记录正文、Cookie 或凭据。
- [ ] 日志脱敏抽样与更广泛自动化安全审计、限流/并发资源上限、运行取消。
- [ ] 不执行模型 shell；完整工具授权与执行不在本轮实现范围，不伪造 `run_command` 或浏览器 `visual_check` 成功事件。
- [ ] 严格零外联仍需浏览器或网络出口隔离。现有 CSP/点击拦截不能可靠阻止 iframe 自身导航外站，URL 归一化校验也不代替出口隔离。

## 2026-10-24 生产发布记录

修复版已发布至 Stars 独立 release，旧 release 保留可回滚；只重启 Stars，未重启 MySQL 或其他项目。002 迁移、最小权限事务探针、真实 Qwen3.8-flash 单计划、候选审批、预览、快照差异/恢复、权限/响应式、重启恢复、加密备份与隔离 schema 恢复均通过。详见 docs/qa/production-acceptance-2026-10-24.md。

## 生产历史记录与本轮发布门禁

此前版本已在 [https://39.107.41.101/](https://39.107.41.101/) 验证 HTTPS、HTTP→HTTPS、MySQL 健康、`stubModel=false` 和 Secure/HttpOnly Cookie。历史真实 Qwen3.8-flash 三文件生成已确认写入云 MySQL，预览交互及刷新恢复通过、浏览器无错误；测试账号和该轮生成数据已清理。短期 IP 证书续期 timer、dry-run 和 Nginx hook 也曾验证。

本轮已更新线上服务并执行迁移 002、真实模型和备份恢复演练；剩余风险为凭据轮换、备份 CBC 完整性/密钥恢复、严格预览出站隔离和远端 CI。`stars-demo/deploy/` 只提供脱敏参考模板，实际主机配置和验收见 docs/qa/production-acceptance-2026-10-24.md。剩余事项：

1. 由迁移身份执行 002，复核 MySQL 业务账号权限和配置，保持单 API 进程。
2. 校验实际 Nginx/systemd 配置，保留凭据权限与证书续期方式；模板存在不代表已安装。
3. 用新版本验证真实模型、两次确认、审批事务、预览、刷新和重启中断，并清理该轮测试数据。
4. 完成备份恢复、安全加固、已暴露 root/管理凭据轮换和严格出口隔离等尚未关闭事项。

每次签署须分别记录本地、CI、生产结果以及未关闭风险，不能用上一版本或 Stub 结果替代新版本真实生成验收。
