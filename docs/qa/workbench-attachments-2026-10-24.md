# Stars 工作台附件菜单回归

日期：2026-10-24。结论：本地完整 Playwright 回归通过，新增附件菜单、文本文件和目录导入测试均通过。测试文件为 [`e2e_regression.py`](../../stars-demo/test/e2e_regression.py)。

## 范围与证据边界

- 验证登录后的“添加 → 上传文件 / 上传文件夹”及其与规划、持久化的连接，不把按钮存在当成功能完成。
- 原站布局参考沿用 [Atoms 已登录观察记录](../research/atoms-authenticated-workbench.md)；该记录的原站现场观察日期是 2026-10-22，本报告没有新增 Atoms 原站登录实测。
- 使用本机动态端口、临时 JSON 存储、合成账号、开发邮件捕获及 Stub 模型。运行中刷新用独立的本地延迟模型服务验证，不调用真实模型或外部 SMTP。
- 截图中的邮箱、附件和项目均为合成测试数据。目录过滤测试创建的是临时 `.env.txt` 等夹具，没有读取工作区 `.env`。
- 本报告证明本地功能和浏览器行为；不证明本轮已部署至公网，也不替代云 MySQL、Cloudflare、真实邮件投递或真实模型验收。

## 通过项

| 能力 | 实际断言 |
| --- | --- |
| 菜单与键盘 | 点击添加可展开；首项获得焦点；方向键、Home、End 切换菜单项；Escape 关闭并还原触发器焦点；Tab 和外部点击关闭 |
| 文件选择 | 通过菜单触发真实浏览器文件选择器，可多选；接受的文本文件显示名称、字符数和移除操作 |
| 目录选择 | 通过菜单触发目录选择器；保留目录相对路径；移除后可再次选择并导入 |
| 输入边界 | 拒绝不支持类型、超过 32 KiB 的单文件及含非法控制字符的文本；最多 10 个附件；合并需求不超过 4,000 字符；修改正文使合并需求超限时发送按钮禁用 |
| 混合选择与去重 | 一次选择中有效文本仍导入，无效文件被跳过；重复路径和内容不重复添加；等待导入结束状态后检查结果 |
| 目录过滤 | 隐藏文件/路径、`node_modules`、`dist`、`build`、`coverage`、`__pycache__`、`target`、`vendor`、锁文件及不支持类型均未进入附件或规划请求 |
| 真实请求与持久化 | 捕获实际 `POST /plans`，检查文件路径和正文进入需求，排除被过滤夹具；随后 `GET /messages` 确认保存的用户需求与该请求一致 |
| 响应式 | 375、768、1280px 视口下菜单在视口内，两项菜单的中心点均可命中且未被其他元素遮挡；页面无横向溢出，已选附件状态也无横向溢出 |
| 原有主流程 | 邮箱捕获注册、语音模拟、文件夹管理与归类、最近/全部项目、独立新建、规划/文件审核、预览实际点击、编辑、快照恢复、运行中刷新、退出登录均随完整套件通过 |

## 本轮发现并修复

375×900 视口下，初始实现始终向下展开菜单。菜单顶端约为 840px、高约 161px，“上传文件夹”越过视口底部。该问题由完整菜单边界和点击命中断言复现。

修复后根据上下可用空间翻转菜单，限制可用高度与水平位置，跟随滚动和视口尺寸更新位置。相同断言重新运行通过；375px 截图可见菜单向上展开，两项均完整可见。

测试同时同步了当前可访问名称“添加参考内容”、聚合导入状态文案和现行页面背景色。没有为通过测试移除功能断言。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `python -m py_compile test/e2e_regression.py` | 通过 |
| `npm run test:e2e` | 通过，输出 `e2e regression passed` 与 `Turnstile regression passed`；主流程、运行中刷新及一次性挑战重试均完成 |
| `npm test` | 22/22 API 与存储测试通过 |
| `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run build` | 全部通过；typecheck 和 format:check 的作用范围以项目脚本为准 |
| `impeccable detect --json stars-demo/src/main.jsx stars-demo/src/styles.css` | 返回空问题列表；不代表完整无障碍认证 |
| `git diff --check -- stars-demo/test/e2e_regression.py docs/qa/workbench-attachments-2026-10-24.md` | 通过 |

浏览器主流程和运行刷新分别检查页面错误；完整回归未收集到未预期错误。未登录时预期的 401 控制台记录按既有规则排除。

## 截图

- [工作台冷启动，1280×900](../../stars-demo/test-results/attachments-workbench-cold-start.png)
- [附件菜单，375×900，向上展开](../../stars-demo/test-results/attachments-menu-375.png)
- [附件菜单，768×900](../../stars-demo/test-results/attachments-menu-768.png)
- [附件菜单，1280×900](../../stars-demo/test-results/attachments-menu-1280.png)
- [目录附件及跳过结果，1280×900](../../stars-demo/test-results/attachments-selected-desktop.png)

上述截图已逐张查看。菜单可见、焦点样式清楚，目录相对路径和跳过说明能够显示。

## 未覆盖

未验证 Safari/Firefox 的目录选择兼容性、真实麦克风、真实模型、Cloudflare 实际挑战、外部邮件投递和生产数据库。额外的隔离浏览器测试以模拟的一次性 Turnstile token 验证登录失败后重试、验证码请求/重发与注册提交各需独立 token；它不等于真实 Cloudflare 服务验收。附件被当作文本上下文送入规划；本轮没有实现图片/PDF 解析、二进制存储、任意目录执行或外部连接器授权。
