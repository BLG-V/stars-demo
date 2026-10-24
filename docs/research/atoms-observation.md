# Atoms 公开页面观察记录

## 记录信息

| 项目 | 内容 |
| --- | --- |
| 观察日期 | 2026-10-22 |
| 页面 | [首页](https://atoms.dev/zh)、`/zh/register?redirect=/zh`、[AI Agents](https://atoms.dev/zh/ai-agents)、[Team Leader](https://atoms.dev/zh/ai-agents/team-leader-agent)、[模型](https://atoms.dev/zh/models) |
| 方法 | 页面阅读和只读交互；未提交注册信息，未读取私有接口 |
| 对应需求证据 | requirements.md 的 E1-E10 |

## 可观察结论

- 首页以品牌导航、登录/注册、自然语言输入、开始入口和示例卡片组织首屏。
- 示例卡片可打开预览对话框，包含关闭和克隆入口；未登录时克隆会转到登录页。
- 注册页提供 Google 和邮箱继续入口，邮箱为空时继续按钮禁用，并显示服务条款和隐私政策链接。
- AI Agents 页面列出 Team Leader、Product Manager、Architect、Engineer、Research、SEO、Ads、Data 等角色，并以多智能体协作作为产品叙事。
- Team Leader 页面描述按顺序拆解计划、分配角色、显示进度，并在方向、范围、技术栈和发布等节点等待批准。
- 模型页列出 Claude、GPT、Gemini、DeepSeek、Qwen 等模型系列；具体账号权限和服务端路由未由公开页面确认。
- 首页还有价格切换、FAQ 折叠和多个 CTA；Stars 将其视为可复用交互参考，不把价格或营销声明当作功能验收证据。

## 逆向边界

公开页面不能证明 Atoms 的权限模型、数据库结构、模型选择策略、命令执行边界、部署行为或生产性能。登录后的工作台、真实生成、预览交互和刷新恢复记录在 `atoms-authenticated-workbench.md` 中；发布、分享、升级和克隆未作为已验证的无副作用能力。
