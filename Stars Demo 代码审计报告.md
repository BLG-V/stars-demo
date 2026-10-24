# Stars Demo 代码审计报告

**审计日期**：2026-10-23
**审计对象**：`D:\work\CodexWork\Atoms-demo\stars-demo`
**审计范围**：`server/`（5 文件）、`src/`（3 文件）、`test/`（4 文件）、配置文件
**动态命令执行**：`pwsh` 受 Windows 沙箱 ACL 限制（Win32 5），`check:syntax`/`test:api`/`build` 无法在本次审计环境运行，标注"无法验证/环境限制"。

------

## 第一部分：需求覆盖表

| 编号          | 需求              | 是否实现                 | 证据                                                         | 风险                                                         |
| ------------- | ----------------- | ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| FR-AUTH-01    | 邮箱注册          | ✅ 实现                   | `server/index.mjs:151-158`；邮箱正则校验、密码>=8位、哈希存储 | 注册返回409 EMAIL_EXISTS 泄露邮箱存在性（详见问题清单）      |
| FR-AUTH-02    | 登录/退出         | ✅ 实现                   | `index.mjs:160-167`；HttpOnly+SameSite=Lax；退出撤销服务端会话 | Cookie Secure 依赖 COOKIE_SECURE 或 NODE_ENV=production      |
| FR-AUTH-03    | 会话恢复          | ✅ 实现                   | `main.jsx:84-98`；刷新后调 `/api/me`+`/api/projects`；URL 中 projectId 恢复项目 | —                                                            |
| FR-AUTH-04    | Google 登录       | ✅ 符合（未实现，未显示） | 前端无 Google 入口；需求要求"未配置时不显示"                 | —                                                            |
| FR-AUTH-05    | 账号错误不泄露    | ⚠️ 部分                   | 登录使用 dummyPasswordHash 防时序；注册409 EMAIL_EXISTS 泄露邮箱存在性 | P2                                                           |
| FR-PROJ-01    | 项目列表          | ✅ 实现                   | `json.mjs:51`；`mysql.mjs:54`；强制 ownerId 过滤+软删除过滤+updated_at 排序 | —                                                            |
| FR-PROJ-02    | 创建项目          | ✅ 实现                   | `index.mjs:171`；记录名称/initialPrompt/创建人/时间          | 名称未填时默认"未命名项目"，可接受                           |
| FR-PROJ-03    | 文件树            | ⚠️ 部分                   | 前端展示文件列表✅；路径白名单 `allowedFilePath`✅；但文件树 UI 未做层级展示，仅为平铺 Tab | P3                                                           |
| FR-PROJ-04    | 文件版本/原子写入 | ✅ 实现                   | MySQL 事务 `completeRun`；JSON storage 单 mutate；失败 failRun 保留旧文件 | —                                                            |
| FR-PROJ-05    | 重命名/软删除     | ⚠️ 部分                   | 重命名用 `window.prompt()`，软删除用 `window.confirm()`；无确认对话框组件，无成功/失败反馈 UI | P2                                                           |
| FR-PROJ-06    | 文件树与编辑      | ⚠️ 部分                   | 文件编辑/保存已接入 API；下载已实现；文件搜索未实现（标注"后续增强"，可接受） | —                                                            |
| FR-AGENT-01   | 需求输入          | ✅ 实现                   | textarea + disabled 当 `!prompt.trim()||running`             | —                                                            |
| FR-AGENT-02   | 规划阶段          | ⚠️ 部分                   | SSE 发送 `planning` 事件，摘要为"拆解页面、交互与文件结构"；未实际先输出目标/页面/交互/文件计划文本再生成 | P2                                                           |
| FR-AGENT-03   | 文件生成          | ✅ 实现                   | 生成 index.html/style.css/app.js；无命令执行                 | stub 生成 style.css 而非 styles.css，与需求不一致（详见问题清单） |
| FR-AGENT-04   | 流式 SSE 状态     | ⚠️ 部分                   | 覆盖 planning/generating/validating/done/error✅；`queued`/`file_change` 事件未实现 | P2                                                           |
| FR-AGENT-05   | 继续修改上下文    | ✅ 实现                   | `generateWithModel` 传入 `currentFiles`；前端复用 currentProject | —                                                            |
| FR-AGENT-06   | 人工确认          | ❌ 未实现                 | 无生成前计划展示+确认步骤；无覆盖文件前的差异展示            | P1                                                           |
| FR-AGENT-07   | 模型失败处理      | ✅ 实现                   | errorCode+summary+SSE error；不伪造成功；api.test.mjs 覆盖所有错误分支 | —                                                            |
| FR-AGENT-08   | 运行事件映射      | ⚠️ 部分                   | planning/generating/validating/done/error ✅；`read_file`/`write_file`/`run_command`/`visual_check` 事件未映射 | P2                                                           |
| FR-PREVIEW-01 | 隔离预览          | ✅ 实现                   | `main.jsx:109` 含 CSP meta 标签；无 allow-same-origin        | —                                                            |
| FR-PREVIEW-02 | 预览装配          | ✅ 实现                   | srcDoc 方式；`safeCss`/`safeJs` 转义 `</style>`/`</script>`  | —                                                            |
| FR-PREVIEW-03 | 真实交互          | ✅ 实现                   | Stub 生成 button#greeting 点击改变欢迎语；Playwright 验证通过 | —                                                            |
| FR-PREVIEW-04 | 预览失败错误面板  | ⚠️ 部分                   | `apiError` 显示在 builder-section；无专属"预览失败"面板和"重新生成"按钮 | P2                                                           |
| FR-PREVIEW-05 | 响应式            | ✅ 实现                   | checklist 记录 375/768/1280 通过                             | —                                                            |
| FR-PREVIEW-06 | 资源与品牌校验    | ✅ 实现                   | `validateGeneratedFiles` 检查 http/https 外链、Atoms 品牌文案；编辑保存也检查 | 外链正则有绕过风险（详见问题清单）                           |
| FR-WORK-01    | 工作区壳          | ✅ 实现                   | 侧栏含工作区/首页/资源/我的项目/文件夹；空状态有入口         | —                                                            |
| FR-WORK-02    | 需求编排器        | ✅ 实现                   | Agent roster、textarea、模式 select、发送 button（disabled 逻辑）、语音按钮 | 语音按钮无功能实现（详见问题清单）                           |
| FR-WORK-03    | 连接器区          | ✅ 符合                   | 无连接器入口，未配置时不暗示已连接                           | —                                                            |
| FR-WORK-04    | Good Path 任务    | ⚠️ 部分                   | 有 stepper 5 步骤；但未实现"阻塞/失败"任务状态的独立 UI      | P3                                                           |
| FR-WORK-05    | 运行时间线        | ⚠️ 部分                   | timeline 组件展示 4 步+详情✅；未展示服务端消息历史/运行记录的全量重放 | P2                                                           |
| FR-WORK-06    | App Viewer        | ✅ 实现                   | 桌面/移动切换、重载、控制台、新标签页、下载；预览失败不遮挡编辑区 | —                                                            |
| FR-WORK-07    | 分享/发布         | ✅ 符合                   | 无分享/发布入口，MVP 要求"未实现时明确禁用或标注"已满足（按钮不存在） | —                                                            |
| FR-WORK-08    | 版本历史          | ⚠️ 部分                   | 快照列表✅；恢复确认对话框✅；但无版本摘要/差异展示（FR-SNAP-02） | P2                                                           |
| FR-WORK-09    | 额度              | ⚠️ 部分                   | 侧栏显示硬编码"1,200 可用积分"；未接入真实 API               | P2                                                           |
| FR-WORK-10    | 刷新恢复          | ✅ 实现                   | URL projectId 参数 + getProject；文件/预览/快照恢复✅；消息历史 UI 未全量展示 | P2                                                           |
| FR-SNAP-01    | 保存快照          | ✅ 实现                   | `createSnapshot` 接口存文件/名称/创建人/时间；MySQL 事务     | —                                                            |
| FR-SNAP-02    | 差异查看          | ❌ 未实现                 | 无版本间差异 UI；`file_changes` 表有数据但前端未展示         | P2                                                           |
| FR-SNAP-03    | 恢复              | ✅ 实现                   | 恢复前自动保护版本✅；失败 catch✅；恢复后 applyProjectData 刷新文件+预览 | —                                                            |

------

## 第二部分：验收对照表

### 阶段 1：项目骨架与质量门禁

| 验收项                                                       | 状态       | 证据/缺口                                                    |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| AC-01 `package.json` 含 dev/build/lint/typecheck/test/test:e2e/format:check | ❌ 不通过   | 缺 `lint`、`typecheck`、`test`（统一）、`format:check` 四个脚本；仅有 dev/build/test:api/test:e2e/check:syntax |
| AC-02 `.env.example` 只含变量名无凭据                        | ✅ 通过     | `.env.example` 含变量名和注释，无真实凭据                    |
| AC-03 `.gitignore` 正确忽略                                  | ✅ 通过     | `.gitignore` 第3行 `.env`、第4行 `.env.*`、第5行 `!.env.example`；node_modules/、dist/、*.log 均已忽略 |
| AC-04 TypeScript strict / schema 校验                        | ❌ 不通过   | 项目为纯 JavaScript，无 tsconfig，无 TypeScript；外部输入用手写检查，无 Zod/schema 库 |
| AC-05 CI 干净环境执行全门禁                                  | ❌ 不通过   | 仓库内无 `.github/`、`.gitlab-ci.yml`、`Dockerfile` 等 CI 配置文件 |
| AC-06 技术边界声明清晰                                       | ⚠️ 部分通过 | `development-plan.md` 中技术栈已记录 Vite+React+Node；需求文档未更新 Next.js 历史引用（未影响实现） |

### 阶段 2：数据库与身份

| 验收项                     | 状态       | 证据/缺口                                                    |
| -------------------------- | ---------- | ------------------------------------------------------------ |
| AC-07 迁移脚本覆盖 8 张表  | ✅ 通过     | `001_initial.sql` 含 users/sessions/projects/project_files/messages/agent_runs/file_changes/snapshots；字段+约束完整 |
| AC-08 STARS_STORAGE 双适配 | ✅ 通过     | `index.mjs:26-31`                                            |
| AC-09 邮箱注册安全         | ⚠️ 部分通过 | 邮箱正则✅、密码>=8✅、scrypt 哈希✅；但密码策略仅有长度要求，无复杂度；409 EMAIL_EXISTS 泄露邮箱存在性（见 P2-01） |
| AC-10 Cookie 属性          | ✅ 通过     | `setSession` HttpOnly+SameSite=Lax；生产 Secure 已确认       |
| AC-11 会话恢复/过期        | ✅ 通过     | findSession 含 expiresAt 校验；前端 401 跳转登录态           |
| AC-12 Google 登录          | ✅ 通过     | 未实现，无入口                                               |
| AC-13 账号错误处理         | ⚠️ 部分通过 | 登录防时序✅；注册 409 EMAIL_EXISTS 泄露（P2-01）；未见密码/Cookie 进入日志 |
| AC-14 强制 owner_id 过滤   | ✅ 通过     | 所有项目查询含 `ownerId=userId`；MySQL 参数化；JSON storage 同等逻辑 |
| AC-15 无权资源 404         | ✅ 通过     | `getOwnedProject` 返回 null → 404；storage.test.mjs 验证枚举防护 |

### 阶段 3：工作台骨架

| 验收项                   | 状态       | 证据/缺口                                                    |
| ------------------------ | ---------- | ------------------------------------------------------------ |
| AC-16 项目列表/创建      | ✅ 通过     | 排序✅、owner 过滤✅、名称/时间记录✅                           |
| AC-17 文件树/编辑/下载   | ⚠️ 部分通过 | 编辑保存✅、下载✅；文件树为平铺 tab，无层级视图               |
| AC-18 重命名/软删除      | ⚠️ 部分通过 | 软删除✅；确认用 `window.confirm/prompt`，无自定义确认框，无明确成功/失败 toast |
| AC-19 工作区壳空状态     | ✅ 通过     | 侧栏结构完整；"还没有项目"空状态有引导按钮                   |
| AC-20 需求编排器         | ✅ 通过     | Agent roster/textarea/模式/语音/发送/禁用状态齐全            |
| AC-21 连接器             | ✅ 通过     | 无连接器入口，未暗示已连接                                   |
| AC-22 Good Path 任务状态 | ⚠️ 部分通过 | stepper 覆盖进行中/完成✅；无阻塞/失败的独立任务卡 UI         |
| AC-23 运行时间线         | ⚠️ 部分通过 | 4 步 timeline✅；服务端消息历史全量 UI 未实现                 |
| AC-24 App Viewer         | ✅ 通过     | 桌面/移动/重载/控制台/新标签/下载全部实现                    |
| AC-25 分享/发布          | ✅ 通过     | 无入口，满足"未实现时明确"要求                               |
| AC-26 版本历史           | ⚠️ 部分通过 | 快照列表/恢复✅；无版本摘要/差异展示                          |
| AC-27 额度显示           | ⚠️ 部分通过 | 硬编码"1,200 可用积分"；未接入 API                           |
| AC-28 刷新恢复           | ✅ 通过     | Playwright 回归通过；URL projectId 机制完整                  |
| AC-29 隔离预览           | ✅ 通过     | srcDoc + CSP meta；无 allow-same-origin                      |
| AC-30 预览装配/过滤      | ✅ 通过     | safeCss/safeJs 转义；CSP 含 `connect-src 'none'`             |
| AC-31 真实交互           | ✅ 通过     | button#greeting 点击+状态变化；Playwright 验证               |
| AC-32 预览失败面板       | ⚠️ 部分通过 | apiError 显示在 alert banner；无专属预览失败面板和重新生成入口 |
| AC-33 响应式             | ✅ 通过     | checklist 记录三视口通过                                     |
| AC-34 资源/品牌校验      | ✅ 通过     | 生成和编辑保存均扫描外链/Atoms 品牌                          |

### 阶段 4：真实模型与编排

| 验收项                       | 状态       | 证据/缺口                                                    |
| ---------------------------- | ---------- | ------------------------------------------------------------ |
| AC-35 空输入禁止提交         | ✅ 通过     | `disabled={!prompt.trim()||running}`                         |
| AC-36 规划阶段先输出计划     | ❌ 不通过   | `planning` 事件仅发一句摘要，无真实内容规划输出；直接进入 generating |
| AC-37 生成三文件+禁止命令    | ✅ 通过     | 无 child_process/exec；真实生成由模型返回文件列表            |
| AC-38 SSE queued/file_change | ⚠️ 部分通过 | planning/generating/validating/done/error ✅；queued 和 file_change 未实现 |
| AC-39 继续修改上下文         | ✅ 通过     | currentFiles 传入 prompt                                     |
| AC-40 生成前计划确认/差异    | ❌ 不通过   | 无任何确认步骤；生成直接运行                                 |
| AC-41 模型失败处理           | ✅ 通过     | api.test.mjs 覆盖 11 种错误；failRun+SSE error               |
| AC-42 运行事件完整映射       | ⚠️ 部分通过 | 3 阶段事件✅；read_file/write_file/visual_check/run_command 未映射 |
| AC-43 密钥/输出校验          | ✅ 通过     | 密钥只从 env 读；validateGeneratedFiles 完整                 |
| AC-44 生产拒绝 stub          | ✅ 通过     | ALLOW_STUB_MODEL 默认 false；api.test.mjs 验证               |
| AC-45 原子写+失败保留旧文件  | ✅ 通过     | MySQL 事务；JSON mutate；storage.test.mjs 覆盖回滚           |
| AC-46 幂等运行ID/重连        | ❌ 不通过   | 无 Last-Event-ID 处理；重连会重复触发生成                    |
| AC-47 快照保存               | ✅ 通过     | createSnapshot 完整；MySQL 事务                              |
| AC-48 差异查看               | ❌ 不通过   | file_changes 表有数据；前端无差异展示 UI                     |
| AC-49 恢复确认+保护版本      | ✅ 通过     | confirmSnapshotRestore 先 createSnapshot 再 restore          |

### 安全验收

| 验收项                     | 状态       | 证据/缺口                                                    |
| -------------------------- | ---------- | ------------------------------------------------------------ |
| AC-50 用户 A 无法读 B 资源 | ✅ 通过     | api.test.mjs 覆盖；getOwnedProject 强制 userId               |
| AC-51 未登录 401/SSE 保护  | ✅ 通过     | requireUser 在 SSE 前执行；api.test.mjs 覆盖                 |
| AC-52 生成内容不读 Cookie  | ✅ 通过     | CSP connect-src 'none'；无 allow-same-origin                 |
| AC-53 仓库无明文凭据       | ⚠️ 部分通过 | 源码/文档无 DB 用户名/密码；`stars-demo/.env` 含真实 DATABASE_URL（见 P0-01）；.gitignore 已忽略，但本地文件存在风险 |
| AC-54 模型输出不可信       | ✅ 通过     | 无 eval/new Function/child_process（grep 验证）；路径白名单+validateGeneratedFiles |

### 非功能需求

| 验收项                  | 状态       | 证据/缺口                                                    |
| ----------------------- | ---------- | ------------------------------------------------------------ |
| AC-55 关键按钮状态      | ⚠️ 部分通过 | 发送禁用/生成中✅；保存文件 savingFile 状态✅；部分按钮无加载/成功/失败反馈 |
| AC-56 性能指标/大小上限 | ⚠️ 部分通过 | 单文件 256 KiB、总生成 1 MiB 限制✅；首屏<3s/SSE<2s 无法验证（线上环境） |
| AC-57 可观测性          | ⚠️ 部分通过 | console.error 记录错误消息✅；无 requestId 机制；无结构化日志 |
| AC-58 可维护性          | ✅ 通过     | 迁移✅；Provider 可替换✅；错误码稳定                          |
| AC-59 可访问性          | ⚠️ 部分通过 | label 关联✅；aria-label✅；aria-live✅；颜色对比度无法验证（环境限制）；部分 focus 样式未见 |
| AC-60 兼容性            | 无法验证   | 需实际浏览器验证；375px 已通过（Playwright）                 |
| AC-61 可靠性/幂等       | ❌ 不通过   | 无幂等运行 ID 复用；无 SSE 重连；无限流                      |

### 交付物

| 验收项                           | 状态       | 证据/缺口                                                    |
| -------------------------------- | ---------- | ------------------------------------------------------------ |
| AC-62 .env.example/迁移/部署说明 | ⚠️ 部分通过 | .env.example✅；迁移✅；部署说明在 development-plan.md✅；无独立 DEPLOY.md/ROLLBACK.md |
| AC-63 E2E 报告/备份恢复演练      | ⚠️ 部分通过 | Playwright 回归已通过✅；备份恢复演练未完成（需求文档和checklist均标注为待完成） |
| AC-64 公网 HTTPS 可用            | 无法验证   | 本地审计无法访问线上；需求文档记录已通过                     |

------

## 第三部分：问题清单

### P0（阻断上线）

**P0-01 · 生产凭据文件存在于本地仓库目录**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `stars-demo/.env`                                            |
| 行号 | 第 2 行（DATABASE_URL）                                      |
| 问题 | `.env` 含真实 MySQL 生产凭据（DATABASE_URL 包含 host/user/password）。虽然 `.gitignore` 第3行已忽略该文件，但（1）无法通过当前审计工具确认该文件是否曾被 git 追踪并进入历史提交；（2）如果团队成员拉取代码后手动创建或复制该文件，凭据泄露窗口依然存在；（3）需求文档 §7.3 明确要求"轮换对话中已经暴露的服务器 root 和数据库管理凭据"，该工作仍待完成 |
| 证据 | grep 确认文件含 DATABASE_URL 含凭据信息；`.gitignore` 第3行含 `.env` |
| 建议 | ①立即运行 `git log --all --full-history -- stars-demo/.env` 确认是否有历史提交；②如有历史提交，执行 `git filter-repo` 清除历史；③轮换数据库密码；④在 README/CONTRIBUTING 中明确说明不得提交 `.env` |

------

### P1（必须在交付前修复）

**P1-01 · 无生成前计划确认和文件覆盖差异展示（FR-AGENT-06）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/index.mjs:224-246`，`src/main.jsx:137-181`           |
| 问题 | 需求明确要求"生成前展示计划并等待确认；覆盖已有文件前展示差异"。当前实现点击"开始构建"后直接调用模型生成，无任何确认节点。已有文件将被静默覆盖 |
| 证据 | `submitPrompt` 直接 `runProject()`；SSE 中 planning 事件无内容文本返回；无 pending approval 状态机 |
| 建议 | 在 planning 阶段先发送文件计划（文件列表+操作类型），前端展示确认对话框；用户确认后再触发 generating |

**P1-02 · SSE 重连导致重复生成（AC-46，FR-AGENT-04）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/index.mjs:227-228`，`src/api.js:33-64`               |
| 问题 | `activeProjectRuns` 使用内存 Set，服务重启后清空；客户端无 `Last-Event-ID` 处理；网络断开重连将触发新一轮生成，可能导致重复写入文件和运行记录。checklist 明确标注为"未完成" |
| 证据 | `activeProjectRuns` 定义于 `index.mjs:32`，进程重启后为空；`api.js` SSE 读取循环无 Last-Event-ID 传递 |
| 建议 | 为每次 run 分配持久化 idempotency key；客户端传递 `Last-Event-ID`；服务端检测运行中状态（从 DB 查询）而非内存 |

**P1-03 · 外链正则可被双重编码绕过**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/index.mjs:75-80`（validateGeneratedFiles），`index.mjs:208-209`（saveProjectFile） |
| 问题 | 代码先做实体解码再检测外链，但正则 `/https?:\/\//` 仅覆盖了 `http://`/`https://`。攻击者可通过 `href="//evil.example/img.jpg"` 的形式引入外部资源。实体解码替换了 `:`/`/` 等，但 `//` 相对协议 URL 的正则为 `/(?<!:)\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}/i`——仅匹配 `//word.word` 格式，不能覆盖如 `//192.168.1.1/` 或含端口的情形 |
| 证据 | `index.mjs:80` 的 `safeContent` 正则对 IP 地址外链无覆盖     |
| 建议 | 补充对 `//\d+\.\d+` 形式（IP 地址）的正则匹配；或改用 HTML 解析器对 `href`/`src`/`action` 属性进行结构化提取验证 |

------

### P2（功能有缺口，影响验收）

**P2-01 · 注册 409 泄露邮箱存在性（FR-AUTH-05）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/index.mjs:153,156`                                   |
| 行号 | 153、156                                                     |
| 问题 | 注册已存在邮箱返回 `{ error: { code: 'EMAIL_EXISTS', message: '注册信息不可用' } }`（HTTP 409），允许攻击者枚举已注册邮箱 |
| 建议 | 方案一：注册总返回 201，通过"请检查邮箱"提示告知用户（行业常见做法）；方案二：维持 409 但错误码不使用 EMAIL_EXISTS，改用通用 REGISTRATION_ERROR |

**P2-02 · 重命名/删除使用原生浏览器弹窗**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx:232,244`                                       |
| 行号 | 232（window.prompt），244（window.confirm）                  |
| 问题 | `window.prompt/confirm` 在部分浏览器中会被拦截（iframe 内、扩展拦截），且不符合像素主题设计规范；无操作成功 toast/反馈 |
| 建议 | 实现与现有 authModal/snapshotModal 一致的自定义确认对话框    |

**P2-03 · 额度硬编码"1,200 可用积分"**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx:326`                                           |
| 行号 | 326                                                          |
| 问题 | 无论用户是谁、使用多少次，均显示"1,200 可用积分"，是虚假数据。需求 FR-WORK-09 要求显示真实剩余积分 |
| 建议 | 短期：改为不显示或显示"—"；长期：接入积分 API                |

**P2-04 · 消息历史/运行时间线未全量 UI 展示（FR-WORK-05/10）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx:77-82`（timeline 仅有当前轮次 4 步）           |
| 问题 | 刷新恢复后，API 返回 `messages`/`runs` 数组，但前端 timeline 不展示历史运行记录，只展示当前轮次进度步骤。需求要求刷新后能看到运行时间线历史 |
| 建议 | applyProjectData 中读取 messages/runs 并渲染历史对话和多轮运行记录 |

**P2-05 · 版本差异（FR-SNAP-02）未实现**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/server/storage/file-changes.mjs`，`src/main.jsx`（快照区域） |
| 问题 | `file_changes` 表已有 `operation/diffSummary` 数据，但前端快照列表无差异展示入口 |
| 建议 | 快照列表增加"查看差异"按钮，调用 `/api/projects/:id/runs` 获取 file_changes 后展示变更摘要 |

**P2-06 · 无结构化请求日志/requestId（§8 可观测性）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/index.mjs:250`                                       |
| 问题 | 仅 `console.error('request_failed', message)`，无 requestId、userId hash、项目 ID、耗时。需求要求"记录 request ID、用户 ID 哈希、项目 ID、运行状态和耗时" |
| 建议 | 在 `handle` 函数入口生成 requestId，记录结构化日志           |

**P2-07 · sandbox iframe 无法阻止外部导航（§7.2）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx:109`                                           |
| 问题 | CSP 含 `form-action 'none'`✅，但需求已明确说明"CSP 不能可靠阻止 iframe 自身导航到外站"，当前无网络出口层阻断，生成内容若包含 JS window.location 跳转仍可跳出。需求标注"严格零外联须配置浏览器隔离或网络出口阻断" |
| 建议 | 短期：在 sandbox 属性中不加 `allow-top-navigation`（已满足）；为高安全场景记录该限制并在文档中明确告知用户 |

**P2-08 · 语音按钮无功能实现**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx:353`                                           |
| 行号 | 353                                                          |
| 问题 | 语音按钮（`<button type="button" ... 语音</button>`）无 `onClick`，按下无任何响应，与需求 FR-WORK-02"语音入口"要求不符 |
| 建议 | 短期：添加 `disabled` 或 `title="语音功能即将上线"`；长期：接入 Web Speech API |

------

### P3（建议优化，不影响上线）

**P3-01 · `package.json` 大量依赖使用 `"latest"` 版本**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `stars-demo/package.json:16-24`                              |
| 问题 | react/react-dom/vite/@vitejs/plugin-react/concurrently 均为 `"latest"`，无 lockfile 固定版本时每次 `npm ci` 可能得到不同版本，破坏可重现构建 |
| 建议 | 固定版本号（如 `"react": "^19.0.0"`）并提交 `package-lock.json` |

**P3-02 · 文件树为平铺 Tab，无层级目录视图**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx`（文件 tab 区域）                              |
| 问题 | 需求 FR-PROJ-03 要求"展示受支持的文件路径"，当前为横向文件名 tab，多文件时溢出；无目录层级感 |
| 建议 | 文件数>6 时改为侧边树形列表；短期可用下拉/更多菜单           |

**P3-03 · `all-in-one App` 组件过大（可维护性）**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx`（373 行单组件）                               |
| 问题 | 整个前端为一个 App 组件，含 25+ useState、所有业务逻辑、所有 UI 片段，维护和测试难度高 |
| 建议 | 按关注点拆分为 AuthModal、SnapshotPanel、PreviewShell、ProjectList、FileEditor 等组件 |

**P3-04 · `main.jsx` 中 `initialFiles` 在前端硬编码占位内容**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `src/main.jsx:17-22`                                         |
| 问题 | 未生成状态时 App Viewer 展示硬编码 `initialFiles` 假数据（index.html/style.css/script.js），可能让用户误以为已生成 |
| 建议 | 未生成时展示空状态 UI 而非占位文件内容                       |

**P3-05 · 服务端仅监听 127.0.0.1 无法通过外部 Nginx 代理访问**

| 项目 | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 文件 | `server/index.mjs:253`                                       |
| 行号 | 253                                                          |
| 问题 | `createServer(handle).listen(port, '127.0.0.1', ...)` 正确绑定本机回环，依赖 Nginx 反向代理——这符合生产部署架构，但审计中无法确认 Nginx 配置是否已正确转发（部署文档仅在 development-plan.md 中描述） |
| 建议 | 将 Nginx 配置纳入仓库（`deploy/nginx.conf`）以便审计和回滚   |

------

## 第四部分：总结

### 4.1 当前项目是否可以交付

**条件性可交付**——线上主流程（注册/登录/生成/预览/快照/刷新恢复）已可运行，Playwright 回归已通过。但存在若干问题需在正式交付前处理。

### 4.2 必须修复项（阻断交付）

| 优先级 | 问题                   | 说明                                                |
| ------ | ---------------------- | --------------------------------------------------- |
| **P0** | P0-01 `.env` 凭据文件  | 确认 git 历史是否含该文件；若有则清除历史并轮换密码 |
| **P1** | P1-01 无生成前确认     | FR-AGENT-06 明确要求，当前静默覆盖文件              |
| **P1** | P1-02 SSE 重连重复生成 | 网络断开会产生重复运行记录和文件写入                |
| **P1** | P1-03 外链正则绕过     | IP 地址格式的 `//` 协议外链可通过校验               |
| **P2** | P2-03 硬编码积分       | 显示虚假数据，误导用户                              |
| **P2** | P2-08 语音按钮无功能   | 点击无响应，须禁用或实现                            |

### 4.3 建议优化项（交付后迭代）

- P2-01 注册 409 泄露邮箱存在性
- P2-02 重命名/删除用原生弹窗
- P2-04 消息历史/运行时间线全量展示
- P2-05 版本差异 UI
- P2-06 结构化请求日志
- P3-01 依赖版本固定
- P3-03 App 组件拆分
- P3-04 initialFiles 占位改为空状态
- P3-05 Nginx 配置纳入仓库

### 4.4 无法确认项（需额外信息或线上环境）

| 项目                                               | 原因                                             |
| -------------------------------------------------- | ------------------------------------------------ |
| `check:syntax` / `test:api` / `build` 命令运行结果 | 审计环境 pwsh 沙箱 ACL 限制（Win32 5），无法执行 |
| `.env` 是否曾进入 git 历史提交                     | git ls-files 需 write 权限，当前无法执行         |
| 线上 HTTPS / 首屏性能 / SSE 延迟                   | 需在公网 `https://39.107.41.101/` 实测           |
| 颜色对比度 WCAG AA                                 | 需浏览器 DevTools 或自动化 axe 检查              |
| 备份恢复演练                                       | 需操作生产数据库，文档标注为待完成               |
| 模型额度/地域可达性/数据保留                       | 依赖外部服务配置，无法从代码验证                 |
| 生产 Nginx 配置                                    | 未纳入仓库，无法审计                             |

## 第五部分：整改复核（2026-10-23）

本报告以上内容保留为整改前审计基线。当时已修改应用代码并实际运行 API、存储和 Playwright 浏览器回归，完整结果及尚未关闭事项见 [审计整改与运行验证](docs/qa/audit-remediation-2026-10-23.md)；该批后来已发布。当前科技工作台的公网发布证据另见 [新版发布记录](docs/qa/production-techworkbench-2026-10-24.md)。
