# Stars Demo 开发步骤文档

## 1. 执行原则

当前工作台已于 2026-10-24 发布到 `20261024T093929Z-workbench`，本批本地 API 22/22、扩展 Playwright 及质量检查通过，云库 004 和公网 MySQL 工作台 10 项烟测通过。本批只重启 Stars，未修改或 reload Nginx；真实模型调用为 0，真实 SMTP、Cloudflare 和麦克风未复测，详见 [本批生产验收](docs/qa/production-workbench-2026-10-24.md)。

仓库采用 Vite + React 工作台和独立 Node API。生产地址为 [https://39.107.41.101/](https://39.107.41.101/)。此前审计修复批次的 19 项 API/存储测试、延迟 mock 重连及 Qwen3.8-flash 三文件生成、预览、刷新恢复和隔离备份恢复记录继续保留；这些历史证据不算作本批重新执行的模型验收。每一步需有可复核产物，并遵循 `requirements.md` 的权限边界和编码规则。

## 2. 建议技术基线

| 层 | 选择 | 说明 |
| --- | --- | --- |
| Web | Vite + React，Node 原生 HTTP API（当前实现） | 独立前端和 API，通过 Vite 代理 `/api` |
| 样式 | 单一 CSS 文件 + Stars tokens | 紧凑、响应式工作台；不复制 Atoms 品牌资产 |
| 校验 | Zod 校验身份、计划和运行输入，其余输入保留边界校验；模型响应只接受 JSON files | 模型产物与手动保存共用 URL/品牌校验；严格零外联仍须浏览器或网络出口隔离 |
| 数据库 | 本地 JSON 文件或云端 MySQL 8 + 参数化 `mysql2` 驱动 | `STARS_STORAGE=json|mysql`；管理员执行迁移后，运行时使用 `STARS_SKIP_MIGRATIONS=true`，应用账号只有业务表读写权限 |
| 身份 | HttpOnly Cookie + Node `scrypt` 密码哈希 + SHA-256 会话 token 摘要（当前） | 生产 Cookie Secure；生产哈希参数、限流和会话清理待安全评审 |
| 流式 | 本地已实现计划确认、SSE 事件持久化与重放、候选文件审核 | `planId` 为幂等键；前端以保存事件 ID 自动恢复观察，限 240 秒；取消、限流及完整工具执行未实现 |
| 预览 | `iframe sandbox="allow-scripts"` + `srcDoc` | 限制在静态项目文件，不执行服务端代码 |
| 测试 | 本批本地 22 项 API/存储、扩展 Playwright、lint、typecheck、format:check、build 通过；公网工作台 10 项烟测通过 | typecheck 仅覆盖 schemas 和工具配置；本批零真实模型调用，SMTP/Cloudflare/真实麦克风未复测 |
| 部署 | IP HTTPS 已上线，当前 release `20261024T093929Z-workbench` | 004 迁移及新表应用账号读探针通过；只重启 Stars，保留旧 release；此前 Qwen/SMTP 记录为历史批次 |

CI 使用 Node 24；部署前核实实际 Node 版本与锁定依赖的兼容性，并记录差异，不能无记录切换运行时。

## 3. REA 逆向工程记录步骤

### 步骤 0：冻结观察边界

**动作**

- 固定参考 URL：`https://atoms.dev/zh`、`/zh/register?redirect=/zh`、`/zh/ai-agents`；登录验证增加 `/zh/dashboard` 和生成后的 `/zh/chat/<project-id>`。
- 记录观察日期、浏览器、页面可见状态和截图路径。
- 公开页面只做无需身份验证的交互；登录验证仅使用用户已提供的会话，不提交注册信息、不读取私有接口或导出会话凭据。

**验证**

- 生成 `docs/research/atoms-observation.md` 和 `docs/research/atoms-authenticated-workbench.md`，每条结论带证据 URL、观察结果、推断和未知项。

### 步骤 1：提取界面和状态

**动作**

- 记录首页导航、自然语言输入、示例卡片、预览对话框、注册表单和 AI Agents 角色列表。
- 对示例“预览”执行一次只读点击，记录对话框、iframe、关闭和克隆入口；克隆触发登录跳转后停止，不创建外部项目。
- 在用户已登录会话中使用不含敏感信息的最小提示词，记录工作台和生成链路；不点击“发布”、不连接第三方服务、不上传文件。
- 将观察结果映射为 Stars 的页面、组件和状态机。

**验证**

- 需求文档 E1-E20 与观察文件一致；营销指标、权限内部实现和发布结果单独标记为未验证。
- 将用户截图记录为 E20：只记录可见的登录后工作台布局；截图中的自然语言内容不作为待提交指令。

### 步骤 2：已登录工作台和真实生成链路实测记录

本轮使用用户已经登录的 Atoms 会话，提交以下不含个人信息、密钥或第三方数据的测试需求：

```text
请生成一个单页 Stars 项目介绍页，包含一个按钮，点击后在页面上切换欢迎语。使用纯 HTML、CSS 和 JavaScript，不连接外部服务。
```

**观察到的工作台功能**

- `/zh/dashboard`：空间导航、首页、资源、我的项目、文件夹、最近项目、创建文件夹、积分余额、升级入口、邀请积分入口。
- 主编排区：8 个 Agent 头像、富文本需求输入、构建模式、语音入口、发送按钮、连接器推荐，以及发现/我的项目/模板标签。
- `/zh/chat/<project-id>`：Good path 任务条、任务计数、聊天时间线、Agent 名称与角色、已处理步数、可折叠工具活动卡、文件树、只读代码预览/编辑保存、版本历史和 App Viewer。
- App Viewer：分享、升级、发布、移动预览、重载查看器、新标签页、控制台、选择元素/修改文本/主题等设计工具。

**观察到的真实生成事件**

1. 进入项目聊天页并显示“持续构建”任务。
2. Agent 显示为 Alex/工程师，最终显示“已处理 8 步”。
3. 时间线出现读取 `README.md`、终端检查、写入 `index.html`、再次检查和可视化检查。
4. 文件树出现 `.atoms`、`app/frontend`、`.mgx`、`README.md`、`index.html`、`package.json`、`script.js`、`style.css`、`template_config.json`、`DESIGN.md` 等文件。
5. 生成完成后出现版本 1、完成摘要、预览任务和发布任务；Good path 由 1/2 进展为 2/4，发布按钮保持未点击。
6. App Viewer 中的生成页面标题为 Stars；按钮“换一句欢迎语”将标题从“你好，欢迎来到 Stars！”改为另一条欢迎语。预览页只读控制台错误/警告检查为空。
7. 刷新聊天 URL 后，需求、时间线、文件树、版本 1、预览和历史记录恢复。

**实测限制和后续实现要求**

- 生成产物仍出现平台默认外部 favicon/OG 图片 URL 和“Made by Atoms”标识，即使需求写了“不连接外部服务”。Stars 必须以服务端资源校验和品牌清理为准，不能只依赖提示词。
- “发布”会产生公网部署副作用，本轮没有点击；Stars 需要在发布前展示目标和权限并写审计记录。
- 本次预览 URL 是会话产物，不作为 Stars 稳定域名或发布成功证据。

## 4. 分阶段实施

### 阶段 1：项目骨架与质量门禁

**任务**

1. 当前基于 Vite、React 和 Node 原生 API；迁移到 TypeScript 或增加生产框架前先记录迁移理由和范围。
2. 已建立 `src/`、`server/storage/`、`server/migrations/`、`test/`；JSON 与 MySQL 适配和初始迁移已实现。
3. 已加入 `.env.example`、`.gitignore` 和 README。
4. 已加入锁定版本与 lockfile、ESLint、限定范围 strict checkJs、Prettier 检查、统一测试脚本和 GitHub Actions CI；生产 Nginx/systemd 参考模板位于 `stars-demo/deploy/`，模板尚未安装。

**验证**

- 审计补充修复后，`npm run lint`、`npm run typecheck`、`npm run format:check`、`npm test`（语法检查及 19 项 API/存储测试）、`npm run build`、`npm run test:e2e` 全部通过；两份 Python 验收脚本通过 `py_compile`。扩展浏览器测试包含延迟本地 mock、运行中刷新恢复和预览全局变量碰撞回归。CI 文件已提供，远端 CI 执行未验证。
- `typecheck` 的 strict checkJs 仅检查 `server/schemas.mjs`、`vite.config.js`、`eslint.config.js`；不代表全应用 TypeScript strict。Prettier 只检查配置、包文件、部署说明和 CI 文件，不宣称格式化全部应用源码。

### 阶段 2：数据库与身份

**任务**

1. 创建 `users`、`sessions`、`projects`、`project_files`、`messages`、`agent_runs`、`file_changes`、`snapshots` 表。
   `002_run_states.sql` 保存计划、候选文件、基线哈希和事件，已在云库应用；本批补齐 `004_folders.sql`，运行账号继续不承担迁移 DDL。
2. 编写可重复执行的迁移和种子脚本，种子数据只用于本地开发。
3. 实现邮箱验证码注册、登录、退出、会话读取和过期清理。验证码通过服务端 SMTP 发送，数据库只保存验证码哈希和过期/尝试状态。
4. 对每个项目接口加入服务端所有权查询。

**验证**

- 验证码发送、过期/错误/重复使用、注册和登录接口测试通过；SMTP 未配置时不创建账号。
- 两个测试用户互相无法读取或修改项目。
- 浏览器刷新后会话恢复；密码、Cookie、数据库连接串不出现在日志。
- MySQL fake pool 测试覆盖参数化 owner 查询和注册/生成/快照事务；此前云 MySQL 已通过独立应用账号注册、Stub 生成、文件审计写入、服务重启恢复和隔离备份恢复验收。本批另通过文件夹与归类的公网 MySQL 持久化及隔离检查。

### 阶段 3：Stars 工作台骨架

**任务**

1. 当前实现首页、登录/注册弹层和以 `projectId` 恢复的工作台。
2. 已实现项目列表/创建/续建、应用内重命名/删除对话框、文件编辑、SSE 状态、消息/运行历史、快照差异和恢复确认；空项目不预填生成文件。
3. 本地 Stub 事件显式标注开发模式；没有模拟成功动画。
4. 375px、768px、1280px 本轮已检查无横向溢出；移动端细节仍需持续回归。
5. 保留工作区壳、Agent roster、需求输入、构建模式、文件树、编辑器和 App Viewer；没有真实计费时显示“暂未启用积分计费”，不显示虚构余额。

6. 按 E11、E20 保留登录后布局与“发现 / 我的项目 / 模板”；本地已补齐受限文本附件、浏览器语音转写、文件夹增删改与项目归类、最近 8 项和账户菜单。连接器不暗示已授权；各能力边界见第 11 节，生产状态以对应批次验收为准。

**验证**

- 375px、768px、1280px 视口无核心控件遮挡。
- 所有加载、空、错误和成功状态可见。
- 固定事件不会进入生产配置。
- 工作台刷新后可重新读取项目详情；发布按钮在未实现时显示规划中或禁用态，不得触发外部副作用。
- 视觉和 DOM 检查确认 E11、E20 对应的入口均纳入实现范围；尚未把 Atoms 的第三方社区弹窗作为 Stars 的核心功能。

### 阶段 4：真实模型与智能体编排

此前计划/审核工作流已通过本地回归及生产真实模型验收，Qwen3.8-flash 三文件结果作为历史验收保留；当前工作台发布批次没有真实模型调用。

**任务**

1. [x] 接入由 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`、`MODEL_TIMEOUT_MS` 配置的 OpenAI-compatible Chat Completions 请求；凭据只从服务端环境变量读取。
2. [x] 提供 `queued/planning/read_file/generating/validating/file_change/review/done/error` 实际事件，持久化事件编号、运行模型、状态和错误码；不伪造 shell 或视觉检查。
3. [x] 仅接受 JSON `{ "files": [{ "path": "...", "content": "..." }] }` 输出；检查安全相对路径、允许扩展名、最多 50 个文件、单文件 256 KiB、总量 1 MiB、重复路径、外链和 Atoms 品牌文本。
4. [x] 服务端保存规则式计划，确认后才调用模型；完整校验后的候选文件停在 `review`，批准时检查基线哈希，再原子提交文件、运行/项目状态和 `file_changes`。放弃、失败或基线过期时不覆盖旧文件。
5. [x] 只有真实模型配置不完整且 `ALLOW_STUB_MODEL=true` 时使用本地开发 Stub；默认不启用 Stub，未配置模型返回明确错误。
6. [x] `planId` 同时作为运行 ID 和幂等键；重复提交重放已持久化事件，可按 `Last-Event-ID` 过滤，不重复调用模型。刷新可读取待审核候选与历史。仅支持单 API 进程，启动时将遗留 `running` 标为 `RUN_INTERRUPTED`。
7. [ ] 增加运行取消和限流；完整工具授权/执行仍为后续范围，不能把静态校验写成浏览器视觉验证。

**验证**

- [x] 此前一轮真实 Qwen3.8-flash 生产验收生成 4 个文件；最新一轮生成 3 个文件。两轮均验证云 MySQL 持久化、预览交互、刷新恢复和无浏览器错误。
- [x] 管理身份运行 MySQL 迁移；以无 DDL 应用账号验证注册、Stub 生成、`file_changes` 审计事务和服务重启后的数据恢复；线上真实 Qwen 生成文件也已在云 MySQL 确认。
- [x] 本地测试覆盖计划幂等重放、审核批准/拒绝、过期基线保护和启动中断状态；浏览器回归覆盖两次确认、历史和快照差异。前端已实现有限自动重连/刷新恢复，240 秒观察上限，连续网络失败受限。
- [x] mock Provider 返回危险路径、重复路径、超大文件、外链或 Atoms 品牌文本时请求被拒绝、原文件保留、运行记录标为失败并发送 SSE 错误。
- 生产线上最新一轮验收覆盖真实模型请求、3 个生成文件的 MySQL 持久化、预览按钮交互和刷新恢复；健康检查显示 MySQL 可用且 Stub 关闭。此前一轮生成的 4 个文件作为历史验收记录保留。
- [x] 清理线上验收期间创建的测试账号和本轮生成数据；保留业务数据不受影响。
- 以真实运行记录验证“读取 README.md → 写入 index.html → 检查 → 可视化检查 → done”的可观察链路；不把 Agent 自报的“已通过”当作唯一证据。

### 阶段 4A：已登录 Atoms 工作台与真实生成链路核验（已完成）

状态：已完成（2026-10-22）。本阶段形成的观察记录见 `docs/research/atoms-authenticated-workbench.md`，并已回写到需求文档 E11-E20。复核时只能使用用户明确提供的已登录浏览器标签；不要从截图推断登录态，也不要读取或导出 Cookie、token、完整网络请求中的敏感字段。

**本轮验证前提**

- 使用用户已提供的登录会话进入 Atoms 工作台和项目聊天页。
- 先确认当前账户、剩余积分和测试项目范围；测试提示词不得包含密码、API key、个人资料或生产数据。

**已执行步骤**

1. 记录工作区名称、左侧导航、积分/配额、输入区模式、工具连接入口、语音入口和底部视图标签。
2. 提交不含个人信息、密钥或生产数据的测试提示词：生成单页 Stars 项目介绍页，按钮点击后切换欢迎语，使用纯 HTML、CSS 和 JavaScript。
3. 记录阶段时间线、代理角色、消息流、文件树、预览面板和错误/重试状态；观察到 Alex/工程师完成 8 步。
4. 在页面预览中点击“换一句欢迎语”，确认标题发生真实变化；只读控制台未见 error/warning。
5. 刷新聊天 URL，确认项目、需求、时间线、文件树、版本 1、预览和历史记录恢复。
6. 未点击发布、分享、升级或克隆，也未连接第三方服务；临时预览 URL 不作为 Stars 最终部署地址。

**产物与停止条件**

- 已生成 `docs/research/atoms-authenticated-workbench.md`；复核记录应继续包含时间、URL、操作、可见结果和“已验证/待确认”标签。
- 如果复核时浏览器会话没有登录态，停止在第 1 步并把“未能访问登录后工作台”写入报告；不能用公开首页或用户截图冒充真实生成验证。
- 如果提交前出现付费、授权、第三方连接或不可逆发布动作，停止并要求用户接管该动作。

### 阶段 3A：Atoms UI 解析与 Stars 前端复刻（已完成）

状态：已完成（2026-10-22）。本阶段按 `C:/Users/V/.codex/skills/web-ui-pipeline/SKILL.md` 的固定链执行：读取 `finesse-brief`、`ui-ux-pro-max`、`finesse-ui`、`design-taste-frontend`、`interface-design`、`frame-smith` 和 `impeccable`；对工作台采用产品/Operate 兼容路线，`frame-smith` 作为普通 Web UI 的兼容判断，不创建 Remotion 视频工程。

#### 复刻范围

1. 解析 Atoms 公开中文首页、AI Agents 页面和已登录 `/zh/dashboard` 的可见布局、组件、状态、排版和交互节奏。
2. 初版复刻 Stars 工作区壳：246px 像素侧栏、工作区切换、导航、文件夹、额度和账户区；这是历史阶段的视觉基线，此前暖色主题改为 240px、16px 外距、20px 圆角浮动侧栏，见第 11 节。
3. 复刻首页编排区：Agent roster、等宽系统标题、自然语言 Composer、构建模式、语音/添加入口、提交状态和三段内容标签。
4. 复刻生成后工作台：Good Path 时间线、文件树、代码预览、App Viewer、桌面/移动切换、控制台和真实预览交互。
5. 不复刻 Atoms 品牌资产、私有实现、平台默认外链或第三方品牌标识；Stars 使用自己的名称、文案和内联 SVG 图标。

#### 技术选型

| 层 | 实现 |
| --- | --- |
| 前端运行时 | Vite 8 + React 19，采用 React 函数组件和 hooks |
| 样式 | 单一 `src/styles.css` 的语义 CSS tokens、响应式媒体查询和 reduced-motion 规则 |
| 图标 | 本地内联 SVG `Icon` 组件，不使用 emoji 作为图标 |
| 状态 | React `useState/useEffect/useMemo`；Node API 支持开发 Stub 与 OpenAI-compatible Provider，服务端保存会话、项目、文件、运行和快照 |
| 验证 | `npm run test:api`、`npm run build`、本地 Vite 浏览器注册/生成/刷新/快照流程检查 |

#### 文件结构变更

```text
stars-demo/
├─ index.html
├─ package.json
├─ package-lock.json
├─ README.md
├─ server/
│  ├─ index.mjs      # API、计划确认、审核、Provider、SSE、请求日志和共用内容校验
│  ├─ schemas.mjs    # Zod 身份/计划/运行输入，strict checkJs 边界
│  ├─ storage/       # JSON/MySQL、事件状态与文件变更事务
│  └─ migrations/    # 001_initial.sql、002_run_states.sql
├─ src/
│  ├─ api.js         # 浏览器 API/SSE 客户端
│  ├─ main.jsx       # 工作区、Composer、生成状态、App Viewer 和快照
│  └─ styles.css     # 观察结果转译后的 tokens、布局和响应式样式
├─ test/
│  └─ *.test.mjs     # API、存储、安全边界与运行恢复测试；e2e_regression.py 为浏览器回归
├─ deploy/          # 脱敏 Nginx/systemd 参考模板及部署说明，尚未安装
├─ eslint.config.js # 全部 JS/JSX/MJS 检查
├─ tsconfig.json    # schemas 与工具配置的 strict checkJs；不覆盖全部应用
└─ dist/             # npm run build 生成，不作为源码编辑入口
```

设计系统检索结果保存于 `design-system/stars/MASTER.md`。实测 Atoms 的中性浅灰工作台覆盖通用设计系统中的紫色默认建议；实现遵循实测 tokens。

#### 验证结果与注意事项

- `npm install`、`npm run build` 和 Playwright 回归已通过；浏览器验证注册→退出→Stub 生成→点击 iframe 内 `button#greeting` 更换欢迎语→刷新后项目与文件恢复。本地开发服务默认可通过 `http://127.0.0.1:5173/` 访问。
- 匿名首次加载发起的 `GET /api/me` 和 `GET /api/projects` 均返回 401，符合未登录初始化查询；曾观察到一次未定位 404，复测未复现。浏览器截图保存在临时目录，未纳入仓库。
- 浏览器可见工作区导航、8 个 Agent、Composer、发现/项目/模板 tabs；输入测试需求后时间线、文件区和预览出现。
- 点击预览“换一句欢迎语”会改变预览标题；桌面/移动按钮和控制台按钮有可见选中状态。
- 审计修复前版本的 API/SSE、JSON 与 MySQL 持久化、项目 owner 隔离和 OpenAI-compatible Provider mock 集成链路均已实现。Playwright 浏览器回归通过；当时生产浏览器以 Qwen3.8-flash 生成 3 个文件，验证预览交互、刷新恢复和无浏览器错误，文件已在云 MySQL 确认。线上地址 `https://39.107.41.101/` 可访问，HTTP 自动跳转 HTTPS，健康状态显示 MySQL 可用且 `stubModel=false`。当时 IP Let's Encrypt 短期证书剩余约 6 天 16 小时；自动续期 timer、dry-run 与 Nginx 部署 hook 已验证。生产请求 timeout 为 180000ms。当时待做安全加固和备份恢复演练；后续隔离恢复与本批备份服务修复见生产记录。验收测试账号及该轮生成数据已清理。
- 原站外部字体、favicon、OG 图片和平台品牌资源不直接复用；若生产需要 IBM Plex 字体，必须通过明确 allowlist 或自托管字体文件接入，并在资源审计中记录。

### 阶段 3B：前端复刻后的质量门禁

**任务**

1. 在 `375px`、`768px`、`1024px` 和 `1440px` 视口检查侧栏、Composer、标签、时间线和 App Viewer。
2. 检查所有按钮、标签、文件行和模式选择的默认、hover、active、focus、disabled、loading 状态。
3. 检查 tab 顺序、ARIA 标签、原生控件语义、对比度和 reduced-motion 行为。
4. 已由服务端 SSE Stub 驱动工作台状态；Stub 响应必须带开发模式标记，服务端拒绝或事件流失败时显示错误，不能将本地动画显示为成功。

**验证**

- 无横向滚动、核心控件不被遮挡、键盘可完成创建和预览交互。
- 构建失败、断线和空状态有明确文本；模拟数据不会进入生产配置。
- 复刻页面仍遵守 `requirements.md` 的外部资源 allowlist、权限边界和品牌清理规则。

### 阶段 5：隔离预览和真实交互

**任务**

1. 将 `index.html`、`styles.css`、`app.js` 装配为预览文档。
2. 使用 `sandbox="allow-scripts"`，不授予同源、顶层导航、弹窗、媒体和设备权限。
3. 清理危险 URL 和超长内容；CSP 限制常规外部资源、连接、表单提交和嵌套 frame；禁止 `eval` 与动态脚本加载。iframe 自身外站导航仍需浏览器级出站拦截才能作为生产边界。
4. 准备验收提示词，要求生成筛选、选项卡或表单校验之一。
5. 在预览错误时保留原文件和工作台操作。
6. 扫描 favicon、OG/Twitter 图片、脚本、字体、图片和 CSS 中的外部 URL；默认删除平台默认域名、Atoms/第三方品牌标识和未配置的资源，allowlist 通过配置注入。

**验证**

- 预览中点击交互控件后状态真实变化。
- iframe 无法读取父页面 Cookie、localStorage 或私有 DOM。
- 生成应用刷新预览后仍能从数据库重新装配。
- 生成“无需联网”的测试应用时，网络请求为空或只命中显式 allowlist；页面不出现平台默认 badge 或品牌文案。

### 阶段 6：快照、差异和恢复

**任务**

1. 保存当前文件清单和内容哈希为快照。
2. 计算文件级新增、修改、删除摘要，限制 diff 大小。
3. 恢复前弹出确认，先生成当前版本保护快照，再事务替换文件。
4. 恢复失败时回滚并显示运行编号。

**验证**

- 修改前后能看见差异。
- 恢复后文件树、消息关联和预览一致。
- 用户 A 无法恢复用户 B 的快照。

### 阶段 6A：工作台恢复与发布边界

**任务**

1. 将工作区状态拆为项目数据、运行事件、预览装配状态和 UI 临时状态；只有前三类进入服务端持久化。
2. 为 Good path 任务保存状态和顺序；任务 CTA 由服务端能力开关控制。
3. 实现分享/发布确认页和审计记录；未完成发布适配前，按钮显示禁用或规划中。
4. 记录额度消耗和运行 ID，避免把第三方积分规则硬编码为 Stars 商业规则。

**验证**

- 刷新聊天 URL 后恢复需求、事件时间线、文件树、版本和预览。
- 直接访问项目 URL 仍执行会话和项目归属校验。
- 未经用户确认不会创建公网发布、连接器授权或第三方写入。

### 阶段 7：安全、可观测性和回归

**任务**

1. 已加入 API request ID、统一错误码和结构化日志；生产日志脱敏抽样仍需复核。
2. 加入请求体大小、生成频率、SSE 并发和单项目文件数量限制。
3. 使用安全扫描检查依赖、容器和敏感信息。
4. 为注册、越权、模型失败、预览隔离和恢复流程补充 Playwright 流程。

**验证**

- 自动化测试覆盖需求文档中的关键验收步骤。
- 日志搜索不到密码、API key、Cookie 和完整敏感提示词。
- 依赖审计、构建和迁移在干净环境通过。

## 5. API 和事件实现顺序

### 5.0 当前实现状态（2026-10-24）

本节实现已包含在当前线上工作台 release 中。计划通过 `POST .../plans` 保存，用户确认后将 `{planId,idempotencyKey:planId}` 发送到运行接口；候选文件持久化后进入 `review`，`approve` 才检查基线哈希并原子写入，`reject` 保留原文件。JSON 的运行详情与 MySQL `run_states` 保存计划、事件和候选。断线后同一计划重放历史；单进程启动会将遗留 `running` 标为 `RUN_INTERRUPTED`，不自动重启模型调用。本批公网只验证到规划，不调用真实模型。

Provider 使用服务端模型环境变量，仅接受 JSON files；校验路径、扩展名、数量/大小、重复路径、外链和品牌文本。模型产物与手动保存共用 `unsafeContent`，归一化 HTML 实体、百分号、JavaScript 转义、TAB/CR/LF 和反斜杠，拒绝显式 `http(s):` 和外链（含编码 IP/IPv6/localhost）；模型与手动保存的绕过回归均已先复现再修复。未配置真实 Provider 时默认拒绝生成；只有显式 `ALLOW_STUB_MODEL=true` 才使用明确标注的本地 Stub。请求响应包含 `x-request-id`，错误包含 `requestId`；JSON 日志记录状态、耗时、已知项目/运行编号、`runStatus` 和模型错误码；客户端断开仍写 `run_finished`，已有测试。日志排除正文和凭据。

默认 `STARS_STORAGE=json`；`STARS_STORAGE=mysql` 与服务端 `DATABASE_URL` 启用 MySQL。发布由迁移身份执行历史及新增迁移，再以低权限运行账号设置 `STARS_SKIP_MIGRATIONS=true`。云 MySQL 已存在 `003_email_verifications.sql`，本批补齐 `004_folders.sql`；应用账号继续不承担 DDL。此前 SMTP 验证码请求公网返回 202 的记录保留为历史证据，本批未发送邮件请求。

此前线上版本的真实模型、预览交互、刷新恢复、MySQL 持久化和隔离备份恢复已验收；本批文件夹/项目导航与权限已另行通过公网烟测。公网地址为 `https://39.107.41.101/`，HTTP→HTTPS 和健康检查正常，证书自动续期保留原配置。本批修复 release 缺失备份脚本导致的服务失败并成功创建加密备份。后续继续安全加固、备份密钥恢复演练和监控；严格零外联仍需网络出口隔离，因为当前预览 CSP 不保证阻止 iframe 自身导航到外站。

先实现以下最小闭环，再扩展接口：

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/me
POST /api/projects
GET  /api/projects
GET  /api/projects/:id
POST /api/projects/:id/plans       # 保存待确认规则式计划
POST /api/projects/:id/runs        # planId + idempotencyKey；SSE/Last-Event-ID 重放
POST /api/projects/:id/runs/:runId/approve
POST /api/projects/:id/runs/:runId/reject
GET  /api/projects/:id/files
POST /api/projects/:id/snapshots
POST /api/projects/:id/snapshots/:snapshotId/restore
POST /api/auth/logout
```

### 5.1 SSE 事件格式

```json
{
  "runId": "run_xxx",
  "type": "queued|planning|read_file|generating|validating|file_change|review|done|error",
  "path": "app.js",
  "summary": "添加分类筛选交互",
  "operation": "added|modified|deleted（仅 file_change）",
  "createdAt": "<RFC3339 UTC timestamp>"
}
```

SSE 建立前校验会话和项目所有权。事件带递增 `id` 和运行编号；`review` 带候选差异，`done` 只在批准提交后保存。断线后可按 `Last-Event-ID` 重放或读取项目历史；前端已按原 `planId` 和最新 `Last-Event-ID` 自动恢复观察，限 240 秒；HTTP 错误停止，连续网络失败受限。

## 6. 权限与编码规则

### 6.1 权限实现规则

- 每个 handler 第一段完成身份和资源归属校验。
- 管理员路由与普通用户路由分开，默认拒绝。
- 智能体工具只接受项目作用域对象，不接受任意路径、任意 URL 或 shell 字符串。
- 预览 iframe 使用独立 React 组件和固定 CSP；任何新增 sandbox 权限必须先写安全评审记录。
- 不把数据库连接、模型密钥、SSH 密钥或内部错误传给浏览器。

### 6.2 编码规则

1. 保持现有 JavaScript/JSX；strict checkJs 目前仅覆盖 `server/schemas.mjs`、`vite.config.js`、`eslint.config.js`，不能宣称全应用 TypeScript strict。身份、计划和运行输入先经 Zod 校验；扩大类型/schema 覆盖须单独记录。
2. ESLint 覆盖应用、服务和测试 JS；Prettier 限定包文件、工具配置、部署说明和 CI 文件。提交前运行 `format:check`、`lint`、`typecheck`、`npm test`、build 和 Playwright；不要把限定范围检查写成全源码格式化。
3. 组件、函数、变量使用清晰英文命名；用户可见文案集中在 locale 文件，MVP 默认简体中文。
4. 数据库使用 `mysql2` 参数化查询与事务；迁移文件不可修改已发布历史。新增运行状态使用 `002_run_states.sql`，不修改 `001` 历史定义。
5. 密码当前使用 Node `scrypt` 哈希，比较使用常数时间实现；邮箱验证码使用随机值、哈希存储、短时过期、单次消费和尝试上限；会话 token 使用安全随机数，服务端只保存 SHA-256 摘要并支持撤销。生产 SMTP 凭据只从受限服务端环境注入，不能写入前端、日志或文档。
6. API 错误使用稳定错误码；日志用 request ID 串联，禁止记录秘密和完整凭据。
7. 禁止 `eval`、`new Function`、任意 `innerHTML`、服务端 `child_process` 和未经审查的动态 import。
8. 文件路径先规范化，再检查允许的相对路径和扩展名；限制单文件和项目总大小。
9. React 表单有 label、键盘焦点和错误关联；按钮在请求期间有禁用态。
10. 每个复杂安全边界前保留短注释，解释约束和失败后果，不写无信息量注释。

## 7. 部署步骤

### 7.0 当前生产部署状态（2026-10-24）

当前 `/opt/stars-demo-release` 指向 `/opt/stars-demo-releases/20261024T093929Z-workbench`，旧 `/opt/stars-demo-releases/20261024-email-verification` 保留。云库已存在 002/003，本批补齐 004；只运行一个 Stars API 进程。公网工作台 10 项烟测通过，本批不执行真实模型生成。`deploy/` 的 Nginx/systemd 文件仍为脱敏参考模板，不冒充生产配置副本。

- 生产网址：[https://39.107.41.101/](https://39.107.41.101/)；HTTP 会跳转至 HTTPS，线上健康状态报告 MySQL 可用、`stubModel=false`。
- Let's Encrypt IP 证书为短期证书，验收时剩余有效期约 6 天 16 小时。Certbot 自动续期 timer、dry-run 和 Nginx 部署 hook 已通过验证。
- 仅重启 `stars-demo.service`，PID `89662 → 92536`，继续监听 `127.0.0.1:8787`；本批 Nginx 配置未改、未 reload。Firestone `127.0.0.1:18573` 检查返回 200，容器未重启。
- 生产环境保留 Qwen3.8-flash 配置和 180000ms 超时；此前三文件真实生成与更早四文件结果为历史验收。本批真实模型调用为 0，SMTP、Cloudflare 和真实麦克风未复测。
- 新 release 补齐 `deploy/backup_stars.py`，修复旧邮箱验证码 release 遗漏脚本造成的备份服务失败；新加密备份成功。此前隔离恢复演练保留，后续继续安全加固和备份密钥恢复演练；本批临时数据清理结果见独立生产报告。

### 7.1 生产配置与后续安全加固

- 主机 `39.107.41.101` 已配置 Nginx、HTTP/HTTPS 和应用服务；继续按 IPv4 地址及短期 IP 证书约束维护。
- 云 MySQL 已使用独立应用账号，Web 进程不得使用数据库 root。后续加固时评估专用 SSH 部署用户，避免日常部署依赖服务器 root。
- 云 MySQL 已建立 `stars_demo_workbench` 数据库和仅有业务表 `SELECT/INSERT/UPDATE/DELETE` 权限的应用账号。迁移需以数据库管理员/部署身份执行，应用服务设置 `STARS_SKIP_MIGRATIONS=true`。
- 生产模型、数据库和会话配置已通过运行环境注入；后续轮换或调整继续使用 Secret 管理或权限至少为 `0600` 的受限文件。
- 不将生产凭据写入仓库、前端、镜像、日志或文档。

### 7.2 首次部署记录与后续发布流程

本项目首次部署已完成。生产应用位于 `/opt/stars-demo-release`，由 `stars-demo.service` 管理；Node API 仅监听 `127.0.0.1:8787`，Nginx 提供公网 HTTPS 与 HTTP→HTTPS 跳转。以下复核项用于未来发布。

1. [x] 构建并发布前端和 Node API 至生产 release 目录；后续发布继续记录版本标识。
2. [x] 执行数据库迁移并检查独立应用账号权限；运行时跳过 DDL 迁移。
3. [x] 以 systemd 管理 API，限制为本机监听；通过 Nginx 提供公网 HTTPS。
4. [x] 配置 Nginx 反向代理、HTTPS 与 HTTP→HTTPS 跳转；证书自动续期 timer、dry-run 和 Nginx 部署 hook 已验证。
5. [ ] 继续复核日志轮转及资源/备份监控；资源上限、加密备份与此前隔离恢复已有记录，本批备份服务成功，密钥恢复演练仍待完成。
6. [x] 执行公网验收：`https://39.107.41.101/`；健康检查、HTTPS、真实生成、MySQL 持久化、预览交互及刷新恢复通过。验收测试账号与该轮生成数据已清理。

### 7.3 回滚与恢复

- 应用回滚：将 `/opt/stars-demo-release` 切回保留的上一 release，再只重启 Stars；先确认数据库迁移兼容性，不删除当前 release 或其他项目数据。
- 数据回滚：优先恢复快照或备份到隔离数据库，验证后再切换；禁止直接覆盖生产数据而无记录。
- 生成失败：运行级重试，不回滚整个数据库。
- 每月至少做一次恢复演练，记录耗时、缺口和修复任务。

## 8. 测试矩阵

本批本地 22 项 API/存储与扩展 Playwright 已通过，云库 004 与公网工作台 10 项烟测通过。下表的 Qwen 生成、审批和隔离恢复结果属于此前真实模型批次；本批规划后不提交生成，真实模型调用为 0，各批证据分别记录。

| 测试层 | 必测内容 | 通过条件 |
| --- | --- | --- |
| 单元 | 路径校验、模型事件 schema、快照 diff、权限判定 | 边界输入和恶意路径均被拒绝 |
| 接口 | 注册、登录、项目列表/创建/读取/重命名/软删除、文件编辑保存、SSE、快照恢复 | 状态码、错误码和归属校验正确；云 MySQL Stub 与生产 Qwen 文件写入、审计和重启/刷新恢复均已验收 |
| 集成 | MySQL 迁移、应用账号权限、审批事务、事件重放 | 原有云库冒烟为历史证据；本轮审批/重放本地通过，前端有限自动恢复已通过延迟 mock；002 云库执行、审批事务和重启恢复均已验证 |
| 浏览器 | 注册→创建→生成→预览→刷新→恢复 | 最新生产 Qwen3.8-flash 3 文件主流程在公网环境通过，无浏览器错误 |
| 工作台 | Dashboard→输入需求→Good path→Agent 事件→文件树→App Viewer | 状态、角色、文件和预览均可观察 |
| 真实交互 | 预览页面按钮点击前后文本变化 | 变化来自生成应用脚本，不是工作台伪造 |
| 资源校验 | 外链、favicon、OG 图片、平台 badge 扫描 | 非 allowlist 资源被移除或阻止 |
| 安全 | 越权、Cookie 隔离、iframe 隔离、秘密扫描 | 无跨用户数据泄露、无明文凭据 |
| 响应式 | 375px、768px、1280px | 无遮挡、关键操作可完成 |

## 9. 上线检查清单

当前工作台 release 已上线，002/003 已存在、本批 004 已执行，保持单 API 进程。下列真实模型、生成预览与恢复勾选项保留此前批次证据；本批公网 10 项烟测不包含付费生成、邮件投递、Cloudflare 或真实麦克风测试。

- [x] 模型服务已配置，线上健康状态显示 `stubModel=false`。
- [x] HTTPS、Nginx 反向代理、HTTP→HTTPS 跳转和健康检查已验证；IP 短期证书的自动续期 timer、dry-run 和部署 hook 已通过。
- [x] 云端应用数据库账号只具备业务表读写权限。
- [ ] 上线后轮换对话中暴露的服务器和数据库管理凭据。
- [x] 本批 release、004 迁移、加密备份和回滚保留目录已记录；此前隔离恢复记录保留。
- [x] 注册、登录、项目隔离、真实生成、预览交互和刷新恢复均通过；生产快照恢复仍需单独演练。
- [ ] 工作台事件链、文件树、App Viewer 和刷新恢复均通过；发布仍遵循确认和审计边界。
- [ ] 生成资产通过外部 URL、默认域名和品牌标识清理规则。
- [ ] 仓库和镜像扫描无秘密；日志脱敏抽样通过。
- [x] 公网验收链接已记录：`https://39.107.41.101/`。
- [x] 验收测试账号与该轮生成数据已清理。
- [ ] 持续安全加固、备份/证书监控并完成备份密钥恢复演练；已有数据库隔离恢复记录。

## 10. 交付顺序和停止条件

当前 Demo 已达到公网可测试状态，入口为 `https://39.107.41.101/`。最新工作台 release、004 迁移及公网 10 项烟测已完成，真实模型调用为 0；邮箱验证码请求和真实生成记录保留为历史批次。以下运维事项仍须完成：

1. 完成生产安全加固与复核。
2. 持续执行数据库隔离恢复演练并记录结果，补齐备份密钥恢复演练。
3. 监控并维护 IP 短期证书自动续期；域名配置后再迁移到长期域名证书。

## 11. 前批工作台视觉重构实施记录（2026-10-24，已部署暖色版）

### 11.1 来源与范围

本节实现已随 `20261024T093929Z-workbench` 上线，文件夹、附件、语音、账户菜单和认证界面纳入当前 release。云库 004 与公网工作台 10 项烟测已通过，本批没有真实模型调用，未复测真实 SMTP、Cloudflare 或麦克风；此前三文件生成与验证码请求仍按历史批次保留。

按 `C:/Users/V/.codex/skills/web-ui-pipeline/SKILL.md` 先读取工作台解析流程，再根据用户提供的截图提取可见结构：侧边导航、顶部品牌与状态、流程指示器、Agent 编排区、自然语言 Composer、发现/项目/模板标签、生成时间线、文件树和 App Viewer。复刻范围限定为布局、组件状态和视觉 token；不复制 Atoms 品牌标识、外部字体、favicon、OG 图或私有实现。

2026-10-24 新增未登录公开页复刻：通过 REA 观察 `https://atoms.dev/zh` 的公开元素，确认其结构为顶部产品导航、Hero 标题与自然语言 Composer、能力/模板卡、团队 Agents、统计背书、FAQ 和页脚。Stars 仅替换品牌名、文案和交互目标，保留浅色中性背景、系统无衬线比例、720px Composer、24px 卡片圆角、蓝色主强调色和柔和阴影。公开页卡片可直接把示例能力写入 Composer，登录/注册按钮打开既有认证流程。

注册入口按用户提供的第二张截图调整：公开页顶部第二个操作按钮改为“注册”；注册弹窗采用白底双栏布局，左侧真实邮箱验证码表单，右侧蓝色 Stars 价值面板和权益列表；移动端改为上下堆叠，验证码、密码、重发倒计时和登录切换仍使用原有 API。

认证安全补充：登录、注册验证码请求和验证码注册确认均携带 `turnstileToken`；服务端调用 Cloudflare Turnstile Siteverify。生产启用前需在服务器和构建环境分别配置 `TURNSTILE_SECRET_KEY`、`TURNSTILE_REQUIRED=true` 与 `VITE_TURNSTILE_SITE_KEY`，密钥不得进入前端或提交记录。

### 11.2 技术实现

- `stars-demo/src/styles.css` 追加暖色 Theme Token：暖象牙白 `#F5F0E8` 画布、奶油白 `#FFFDF8` 容器、陶土橙 `#C96B4B` 主操作色、鼠尾草绿 `#8FA58B` 辅助状态、柔和紫 `#A89BC7` 次级强调、炭墨 `#29251F` 文字。
- 未登录公开页使用独立 `.public-shell` 视觉层：浅灰画布、蓝色品牌强调、顶部 `.public-nav`、`.public-sections` 能力/统计/Agents/FAQ/页脚模块；不显示登录后侧栏、项目列表和运行流程。
- 桌面端 `.app-shell` 使用 16px 外边距；`.sidebar` 改为 240px 浮动面板，四边留 16px、圆角 20px、低透明度柔和阴影和轻微毛玻璃；内容卡片使用 16px 圆角与低对比阴影。标题使用衬线显示字体，正文使用系统无衬线，代码区域保留等宽字体。
- 交互保留清晰 hover、focus、disabled、loading 和 reduced-motion 状态；移动端侧边栏回落为顶部面板，避免压缩主内容。
- 未登录态新增 Stars 公开页布局：顶部产品导航、居中 Agent 头像组、主标题和大尺寸圆角 Composer，向下延伸能力卡、统计背书、Agents、FAQ 和页脚；登录后通过 `.authenticated-shell` 恢复完整工作台。
- `stars-demo/src/main.jsx` 增加顶部 `workflow-panel` 和生成区 `segment-progress`，连接线为虚线，当前步骤和完成步骤使用不同高亮态。
- 保留原有 API、权限校验、JSON/MySQL 存储、OpenAI-compatible Provider、SSE、文件编辑、快照和沙箱 iframe，视觉层不扩展服务端权限。

### 11.3 文件结构变更

```text
stars-demo/
├─ src/main.jsx                  # 浮动侧栏、附件/语音、文件夹/归类、账户菜单和工作流
├─ src/api.js                    # 文件夹 CRUD 与项目归类 API 客户端
├─ src/styles.css                # 暖色 token、菜单/附件状态、响应式和 reduced-motion
├─ server/index.mjs              # 会话用户范围内的文件夹与项目归类路由
├─ server/storage/               # JSON/MySQL 文件夹持久化与 owner 校验
├─ server/migrations/004_folders.sql # folders 与 project_folders
├─ test/folders.test.mjs          # 文件夹归属、CRUD 与项目归类接口边界
├─ test/storage.test.mjs          # 包含文件夹的存储一致性验证
├─ test/e2e_regression.py         # Playwright 浏览器回归脚本
├─ package.json                  # test:e2e 与 @playwright/test 开发依赖
└─ .env.example                  # 脱敏模型、SMTP 和认证配置示例
```

### 11.3.1 工作台能力补全

- 文件夹：`GET/POST /api/folders` 与 `PATCH/DELETE /api/folders/:folderId` 支持个人文件夹列表、创建、重命名和删除；`PATCH /api/projects/:projectId` 设置 `folderId`，`null` 表示未分类。删除文件夹只清除归类，不删除项目；相同用户内名称唯一。迁移 `004_folders.sql` 已通过部署迁移身份在云库执行，新表读探针及公网持久化通过，运行时身份继续遵守最小权限。
- 项目导航：文件夹筛选只作用于当前用户项目；“最近项目”按 `updatedAt` 倒序取 8 项。创建项目可归入当前文件夹；项目行支持移动到个人文件夹或未分类。
- 显式新建项目先清空旧项目、文件、预览、历史和 URL 上下文，保留当前文件夹；生成、计划确认、文件审核或保存期间禁止新建，避免覆盖旧项目。“全部项目”同时退出最近项目筛选。
- 移动端顶部面板保留文件夹创建、归类列表及账户菜单；文件夹操作目标至少 44px，管理菜单在面板内展开，避免被滚动容器裁切。
- 文本附件：浏览器最多选择 3 个文件，每个不超过 32 KiB；支持 `.txt/.md/.json/.csv/.html/.css/.js/.ts/.tsx/.jsx/.yml/.yaml/.xml/.svg/.sql`，检查异常控制字符。文件名和正文合并到当前需求后仍须符合 4,000 字符上限；用户可移除附件。不新增二进制上传或原文件存储接口，合并文本会随项目需求/消息持久化。
- 语音：使用 `SpeechRecognition` / `webkitSpeechRecognition` 转写中文需求，支持开始、停止、错误和权限拒绝反馈；结果可编辑后提交。应用不保存原始音频，浏览器可能使用远程识别服务；不支持的环境给出可访问的降级提示。
- 账户：卡片显示真实邮箱并打开会话菜单；退出复用现有 logout 撤销会话，清空前端账户、项目和文件夹状态。访客账户入口打开登录界面。
- 运行状态：生成、计划确认和候选审核期间禁用冲突的工作区操作，避免附件、文件夹或项目切换造成状态错位。

### 11.4 编码与权限边界

- 模型 API Key 只由服务端环境变量读取，禁止写入源码、前端 bundle、Markdown、测试截图、日志或提交记录；`MODEL_NAME` 使用 `qwen3.8-flash`，Base URL 由部署环境配置。
- 前端不能绕过服务端 owner 校验访问项目、文件夹、文件、运行记录或快照；移动项目时校验项目与目标文件夹均属于当前会话用户。新 UI 组件只能消费受控 API 和真实状态。
- 预览仍使用 `sandbox="allow-scripts"` 和固定 CSP；任何新增 sandbox 权限需要安全评审。
- 组件必须有可见 focus、disabled、loading、error 和 reduced-motion 状态；当前暖色主题允许设计系统定义的圆角与柔和阴影，禁止未经 allowlist 的外部资源。

### 11.5 验证步骤

1. `npm run check:syntax`、`npm run test:api` 和 `npm run build`。
2. 运行 `npm run test:e2e`，自动隔离启动 API 和 Vite，覆盖匿名首屏、验证码注册、Stub 生成、暖色 token/圆角/浮动侧栏、预览交互、响应式无溢出和刷新恢复；补充文件夹 CRUD/归类/最近项目、附件选择/移除/超限、语音降级和账户菜单回归。
3. 使用 `impeccable detect --json stars-demo/src/styles.css stars-demo/src/main.jsx` 检查机械性问题。
4. 真实模型验收时，在运行环境设置 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME=qwen3.8-flash`、`ALLOW_STUB_MODEL=false`；若供应商返回错误，记录错误并保持失败状态，不能回退为 Stub 冒充成功。

本批本地验收已通过：API 22/22、Playwright 扩展回归、build、lint、typecheck、format:check 和差异空白检查；Impeccable 源码检测返回空问题列表。本地测试为隔离 JSON、Stub 模型、邮件捕获和模拟语音识别，见 [登录后工作台验收记录](docs/qa/logged-in-workbench-2026-10-24.md)。发布后另通过云 MySQL 工作台 10 项公网烟测，浏览器错误为 0，见 [本批生产报告与截图](docs/qa/production-workbench-2026-10-24.md)；本批真实模型调用为 0，真实 SMTP、Cloudflare 和麦克风未复测。

### 阶段 3B：主题与回归验收（2026-10-24，历史记录）

本节为本轮审计修复之前的验收；其中 10 项测试和三文件线上结果不代表新版本验收。本轮本地 19 项与扩展回归结果见阶段 1。

- 保留历史像素主题实现作为兼容基线；本轮按用户新方向将工作台切换为暖色亮色高级风格，使用浮动侧栏、16px 外边距、20px 圆角、柔和阴影、衬线标题和系统无衬线正文。
- 侧栏仅在移动端回落为顶部面板，桌面端保持独立浮动层；所有生成、预览、文件编辑和注册交互沿用原权限与数据边界。
- 修正 Playwright 启动器在 Windows 上无法定位 `npm` 可执行程序的问题，改为通过当前 Node 调用本地 Vite CLI；回归测试断言暖色背景、陶土橙当前步骤和圆角工作台卡片。
- 已验证 Python 测试脚本语法、`npm run check:syntax`、`npm run test:api`（10 项）、`npm run build` 和 `npm run test:e2e`。Qwen3.8-flash 真实生成保存、预览交互与刷新恢复验收通过；云 MySQL 迁移、最小权限应用账号、Stub 写入、文件审计和重启恢复通过。此前 SSH 认证及端口状态问题已解决。生产站点已部署并可通过 HTTPS 访问，HTTP 自动跳转 HTTPS；该轮验收的 3 个文件已写入云 MySQL，预览交互、刷新恢复通过，浏览器错误为零。验收测试账号与该轮生成数据已清理。IP 短期证书自动续期 timer、dry-run 与 Nginx 部署 hook 已验证。仍待安全加固和备份恢复演练。


## 12. 本轮附件菜单与科技工作台（2026-10-24）

### 12.1 流程与选型

按 `web-ui-pipeline` 顺序修订既有 `.workbench/spec.md` → `ui-ux-pro-max` 查询方向 → `finesse-ui` 实现 → app-screen 风格精修 → `interface-design` 产品校对 → 原生 CSS 动效决策 → `impeccable` 与浏览器质量门禁。参考资料为用户新上传的 Atoms 工作台截图，只提取可见布局与交互层级。

保留现有 React 19/Vite 8、原生 CSS/SVG 和 File API。主工作台采用雾灰 `#F5F6F8`、微冷白面板与蓝色 `#4467F5`，系统无衬线字体，低对比细边框；保留 16px 外距、240px 浮动侧栏、20px 圆角。公开页与认证弹层使用独立视觉层。无新组件库、外部字体、图片依赖或动画引擎。

### 12.2 开发步骤与文件变更

1. `src/main.jsx`：添加可访问菜单与独立 file/directory input；原生目录选择保留相对路径，过滤隐藏项、依赖/构建目录和锁文件，按白名单/大小/总字符/重复规则导入，显示导入及跳过结果。
2. 同文件增加导入锁与冲突操作保护；保持计划确认、候选审核、用户归属与预览权限；冷启动以 Composer 为主，有上下文时展示流程。
3. `src/styles.css`：在既有主题结构中调整登录后 token、字体、导航、Composer、菜单、发现卡和生成面板，避免叠加新的全局主题；移动菜单可触控且不溢出。
4. `test/e2e_regression.py`：验证原生文件/目录选择、菜单焦点、嵌套路径/过滤/限制/重复/移除及规划上下文，并保留注册、文件夹、生成、预览、刷新回归。`test/turnstile_regression.py` 使用隔离的浏览器网络与模拟单次 token，覆盖登录失败重试、验证码重发及注册提交；每次请求后重置挑战。
5. 同步 `.workbench/spec.md`、`design-system/stars/MASTER.md`、需求/开发和 README；结果保存在 `docs/qa/workbench-attachments-2026-10-24.md` 与 `test-results/`。
6. 运行 lint、typecheck、format:check、build、API 与 Playwright；检查暂存差异和敏感内容后提交、普通推送到现有 `origin/master`，核对远端提交。

### 12.3 编码、权限与注意事项

- 最多 10 个文本、每个 32 KiB、合并需求 4,000 字符；仅浏览器明确选中文件可读。不能上传整棵任意磁盘目录，也不新增任意路径读取 API。
- 目录结构用相对路径传达；跳过隐藏项、依赖/构建文件与锁文件，重复项不重复占配额。过滤不构成秘密检测承诺，用户应只选择愿意交给模型的文本。
- 原文件不单独保存；合并文本会作为项目需求/消息持久化并发送给已配置模型。此能力不等价于二进制解析或无限制代码仓库导入。
- 使用现有 JSX 风格，不重排无关文件、不清除其他项目数据；锁定导入过程的冲突操作并在退出或上下文变化时防止过期结果回写。
- 菜单有语义角色、可见 focus 与合理焦点返回；动效仅为短暂状态反馈，尊重 reduced-motion，不引入 Remotion/GSAP。
- 不改生产端口、数据库迁移、Nginx 或其他项目服务。本轮用户授权为 GitHub 同步，新的主题与目录入口不自动计入上批公网验收。
