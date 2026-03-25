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
4. [Agent Turn Loop 设计稿](./agent-loop.md)
5. [TUI 层细化计划](./tui.md)
6. [Coding-Agent 层细化计划](./coding-agent.md)
7. [Session 子系统计划](./session/README.md)
8. [Session 实现计划](./session/implementation.md)
9. [Session 测试计划](./session/testing.md)
10. [Coding-Agent Auto-Compaction 产品化实施稿](./coding-agent-auto-compaction.md)
11. [测试配置](./test-config.md)

推荐实现顺序：

1. `ai`
2. `agent`
3. `tui`
4. `coding-agent`

原因很简单：`AI` 层先稳定统一协议，`Agent` 层再围绕统一协议建立 turn loop，`TUI` 层消费事件做展示，最后由 `Coding-Agent` 层把 session tree、工具和终端交互装配起来。

## 4. 文档依赖关系

- [AI 层细化计划](./ai.md)：定义统一模型调用协议，是其它三层的基础。
- [Agent 层细化计划](./agent.md)：依赖 AI 层协议，定义状态机、turn loop 和工具编排。
- [Agent Turn Loop 设计稿](./agent-loop.md)：给出当前 `MVP` `Agent` runtime 的状态机、闭环路径、事件顺序和停止语义。
- [TUI 层细化计划](./tui.md)：依赖 Agent / Coding-Agent 发出的标准化事件，不依赖具体模型厂商。
- [Coding-Agent 层细化计划](./coding-agent.md)：组合前三层，并负责 session tree、工具实现、上下文组装和 CLI 语义。
- [Coding-Agent Auto-Compaction 产品化实施稿](./coding-agent-auto-compaction.md)：补充当前 coding-agent 在自动 compaction、context usage 估算、overflow recovery 和 UI/config 暴露方面的产品化实施要求。
- [Session 子系统计划](./session/README.md)：把 `Coding-Agent` 中最复杂的 session 子系统单独拆开，覆盖存储、tree、context rebuild、`/tree`、`/fork`、compaction 和 runtime 桥接。
- [Session 实现计划](./session/implementation.md)：按未来 `package/coding-agent` 的文件布局拆分落地顺序、模块职责和里程碑。
- [Session 测试计划](./session/testing.md)：定义 session 的单测、集成测试、交互 smoke 与“像 pi 一样可用”的验收标准。
- [测试配置](./test-config.md)：记录当前可直接用于后续联调和验收的 provider 测试入口与凭证。 

## 5. 文档用途说明

- [AI 层细化计划](./ai.md)
  用于约束统一协议、provider adapter、模型目录和认证策略，避免不同厂商接入方式向上泄漏。
- [Agent 层细化计划](./agent.md)
  用于约束状态机、turn loop、工具调用回路和事件生命周期，避免编排逻辑散落到其它层。
- [Agent Turn Loop 设计稿](./agent-loop.md)
  用于沉淀当前 `MVP` 已定的运行时设计，方便实现对照、评审和后续调整。
- [TUI 层细化计划](./tui.md)
  用于约束终端展示和输入边界，保证界面层不反向主导业务协议。
- [Coding-Agent 层细化计划](./coding-agent.md)
  用于约束 session tree、工作区工具、分支恢复和终端产品形态，是最接近最终 CLI 形态的装配层文档。
- [Coding-Agent Auto-Compaction 产品化实施稿](./coding-agent-auto-compaction.md)
  用于把“已经存在的 manual compaction 基础能力”继续推进为“可日常使用的 auto-compaction 产品策略”，重点覆盖 context usage 估算、80% 阈值触发、overflow recovery 和 UI/config 暴露。
- [Session 子系统计划](./session/README.md)
  用于把 session 从 `Coding-Agent` 总装层中拆出来，单独定义存储、tree、context rebuild、compaction、`/tree`、`/fork`、resume/new 等完整需求。
- [测试配置](./test-config.md)
  用于固定当前后续测试默认使用的 provider 地址、API Key 和环境变量约定。

## 6. 本轮不做的事情

- 本轮文档工作不创建或修改未来 `package/coding-agent` 的源码目录。
- 本轮文档工作不实现任何新的 TypeScript 接口、类型、测试或 CLI。
- 不替换当前已选定的 `@mariozechner/pi-tui`。
- 不额外拆出独立 `tools` 包。

## 7. Git 提交约定

- 每完成一个独立的实现或修改，都应立即进行一次本地 `git commit`。
- 每次提交应尽量保持原子性，一个 commit 只承载一组明确、可描述的变更。
- 当前只要求本地提交，不要求同步推送到远端仓库。
- 如果一次工作包含多个彼此独立的修改，应拆成多个本地 commit，而不是混在一次提交里。
