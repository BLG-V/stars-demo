---
purpose: "Stars AI 应用生成工作台"
surface: product
subject: generated_project
roles:
  - name: 普通用户
    actions: [创建项目, 提交需求, 查看运行, 检查预览, 恢复快照]
hook:
  statement: "当前项目的生成状态、待处理动作和可运行预览"
  fields:
    - field: project.status
      writer: system
    - field: agent_run.status
      writer: system
    - field: project_files.content_hash
      writer: system
    - field: messages.content
      writer: user
cold_start:
  day_1: "创建第一个项目并输入一句需求"
  empty_preview: "尚未生成预览；提交需求后开始构建"
modules:
  - name: 工作区导航
    verb: "切换空间、项目和文件夹"
  - name: 需求编排器
    verb: "输入需求并选择构建模式"
  - name: Agent 运行流
    verb: "查看规划、生成、校验和失败状态"
  - name: 文件与代码
    verb: "浏览生成文件并查看内容"
  - name: App Viewer
    verb: "运行预览并检查真实交互"
  - name: 版本历史
    verb: "保存、比较和恢复快照"
excluded: [支付, 任意服务器命令, 任意 npm 安装, 第三方连接器写入]
deferred: [完整 Agent 工具事件、SSE 重连与幂等、发布和分享]
success_criteria:
  - "工作台在桌面与移动视口可用"
  - "提示词提交产生可观察阶段状态"
  - "预览按钮能改变生成应用状态"
  - "真实后端接入前不把本地模拟事件标记为生产成功"
---

# 给实现方

Stars 是围绕“生成一个项目并反复检查、修改、恢复”的产品工作台，不是静态营销页。首屏按 Atoms 实测工作台的结构组织：左侧工作区导航，中央 Agent roster、等宽系统标题和自然语言 Composer，下方发现/项目/模板入口；提交后在同一页面显示运行流、文件树、代码预览和 App Viewer。当前视觉方向是用户截图确认的黑底、荧光绿、Royal Blue 像素科技主题。

本地 `stars-demo` 已接入可配置 API、SSE、JSON/MySQL 存储适配和受限预览。前端像素科技主题基于用户截图：工程黑底、荧光绿主动作色、Royal Blue 结构线、矩形容器、等宽标题、顶部流程条与分段进度；主题只改变视觉表达，不扩大生成、发布或数据访问权限。未配置真实模型时，Stub 仅用于开发且页面明确标注。
