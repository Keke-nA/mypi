# 模块计划文档索引

## 1. 文档定位

`docs/goal.md` 是项目总纲，负责说明整体目标、四层架构和阶段方向。

`docs/plan/*.md` 是模块级执行计划，负责把每一层拆成可以直接进入实现的待办事项、接口边界和验收标准。

这一组文档当前只用于规划，不等于已经开始实施，也不代表仓库中已经存在对应的 `package/*/src` 代码。

## 2. 当前默认决策

- 当前以 `MVP` 为第一目标，优先打通最小可运行闭环。
- `AI` 层首批 provider 固定为 `OpenAI + Anthropic`。
- 工具编排在 `Agent` 层完成，但工具实现归 `Coding-Agent` 层提供。
- `MVP` 工具范围固定为 `bash`、`read`、`write`、`edit`。
- `TUI` 层先做框架无关接口，再提供默认终端渲染实现。
- `session tree` 在 `MVP` 阶段就要求文件持久化。
- 从历史 `turn` 恢复分支时，允许用户选择是否生成并注入该分支的模型摘要。
- 当前测试基线优先使用可用的 `OpenAI` 中转地址和 API Key，`Anthropic` 凭证暂时缺失。

## 3. 推荐阅读与实现顺序

推荐阅读顺序：

1. [项目总纲](../goal.md)
2. [AI 层细化计划](./ai.md)
3. [Agent 层细化计划](./agent.md)
4. [TUI 层细化计划](./tui.md)
5. [Coding-Agent 层细化计划](./coding-agent.md)
6. [测试配置](./test-config.md)

推荐实现顺序：

1. `ai`
2. `agent`
3. `tui`
4. `coding-agent`

原因很简单：`AI` 层先稳定统一协议，`Agent` 层再围绕统一协议建立 turn loop，`TUI` 层消费事件做展示，最后由 `Coding-Agent` 层把 session tree、工具和终端交互装配起来。

## 4. 文档依赖关系

- [AI 层细化计划](./ai.md)：定义统一模型调用协议，是其它三层的基础。
- [Agent 层细化计划](./agent.md)：依赖 AI 层协议，定义状态机、turn loop 和工具编排。
- [TUI 层细化计划](./tui.md)：依赖 Agent / Coding-Agent 发出的标准化事件，不依赖具体模型厂商。
- [Coding-Agent 层细化计划](./coding-agent.md)：组合前三层，并负责 session tree、工具实现、上下文组装和 CLI 语义。
- [测试配置](./test-config.md)：记录当前可直接用于后续联调和验收的 provider 测试入口与凭证。

## 5. 文档用途说明

- [AI 层细化计划](./ai.md)
  用于约束统一协议、provider adapter、模型目录和认证策略，避免不同厂商接入方式向上泄漏。
- [Agent 层细化计划](./agent.md)
  用于约束状态机、turn loop、工具调用回路和事件生命周期，避免编排逻辑散落到其它层。
- [TUI 层细化计划](./tui.md)
  用于约束终端展示和输入边界，保证界面层不反向主导业务协议。
- [Coding-Agent 层细化计划](./coding-agent.md)
  用于约束 session tree、工作区工具、分支恢复和终端产品形态，是最接近最终 CLI 形态的装配层文档。
- [测试配置](./test-config.md)
  用于固定当前后续测试默认使用的 provider 地址、API Key 和环境变量约定。

## 6. 本轮不做的事情

- 不创建 `package/ai`、`package/agent`、`package/tui`、`package/coding-agent` 的源码目录。
- 不实现任何 TypeScript 接口、类型、测试或 CLI。
- 不绑定具体 TUI 框架。
- 不额外拆出独立 `tools` 包。
