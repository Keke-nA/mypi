# Agent 层细化计划

补充说明：

- 当前 `MVP` 的已定 `turn loop` 设计见 [Agent Turn Loop 设计稿](./agent-loop.md)
- 本文档继续保留“计划 / 边界 / 验收”定位

## 1. 目标

Agent 层的目标是把一次任务执行组织成状态化的 `turn loop`，统一控制何时继续推理、何时调用工具、何时结束当前 turn。

这一层不是产品层，也不是工具层，而是运行编排层。

## 2. 职责边界

### 本层负责

- 定义 `turn` 级执行输入和输出
- 定义状态机和循环推进规则
- 编排模型调用与工具调用的闭环
- 统一运行时事件生命周期
- 统一停止原因和失败原因

### 本层不负责

- 具体工具实现
- session tree
- 分支恢复
- 分支摘要生成与注入
- 终端展示
- 工作区扫描

### 上下游关系

- 上游主要是 `Coding-Agent` 层
- 下游依赖统一的 `AI` 客户端和外部注入的 `toolExecutor`
- 本层不能持有会话存储，也不能依赖具体 `TUI` 框架

## 3. 公开接口

### `createAgentRuntime(config)`

创建 Agent 运行时实例，注入 `aiClient`、`toolExecutor`、`eventSink` 和运行时 guard 配置。

### `prompt(input)`

发起一次新的 turn run，返回完整的 turn 结果。

### `continue(input)`

基于已有上下文或上一个 turn 的结果追加一次新的 turn run。

## 4. 关键类型

- `TurnInput`
  单次 turn 的输入，承载消息上下文、可用工具、运行限制和附加元数据。
- `TurnResult`
  单次 turn 的完整结果，包含最终消息、工具调用记录、状态摘要和停止原因。
- `AgentState`
  运行时状态枚举，描述当前 turn 处于哪个阶段。
- `StopReason`
  turn 结束原因枚举，统一正常结束、步数上限、工具上限、取消和失败。
- `AgentEvent`
  运行时事件结构，供 `TUI`、日志和上层集成消费。
- `ToolExecutor`
  外部注入的工具执行器接口，由 `Coding-Agent` 实际提供实现。

## 5. 运行流程

1. 调用方创建 `AgentRuntime` 并注入 `aiClient`、`toolExecutor`、`eventSink`。
2. 调用 `prompt(input)` 或 `continue(input)` 发起一次 turn。
3. Agent 进入 `model_requesting`，向 `AI` 层发起模型请求。
4. Agent 接收流式事件并推进到 `model_streaming`。
5. 如果模型输出普通文本且没有工具请求，则进入 `finalizing` 并结束 turn。
6. 如果模型请求工具，则进入 `awaiting_tool_execution`。
7. Agent 通过 `toolExecutor` 串行执行工具，并把结构化结果回灌模型上下文。
8. Agent 回到模型调用阶段，继续循环直到满足结束条件。
9. Agent 输出 `TurnResult`，同时发出完整的生命周期事件。

## 6. Todo

- [ ] 定义 `TurnInput`。
- [ ] 定义 `TurnResult`。
- [ ] 定义 `AgentState`。
- [ ] 定义 `StopReason`。
- [ ] 定义 `AgentEvent`。
- [ ] 明确 `prompt()` 的输入语义。
- [ ] 明确 `continue()` 的输入语义。
- [ ] 设计单 turn 的循环边界。
- [ ] 设计 `idle` 状态的进入和退出条件。
- [ ] 设计 `model_requesting` 状态的职责。
- [ ] 设计 `model_streaming` 状态的职责。
- [ ] 设计 `awaiting_tool_execution` 状态的职责。
- [ ] 设计 `finalizing` 状态的职责。
- [ ] 设计 `completed` 和 `failed` 的收束规则。
- [ ] 设计模型输出普通文本的结束路径。
- [ ] 设计模型请求工具后的循环路径。
- [ ] 规定 `MVP` 中多工具调用按串行执行。
- [ ] 设计工具执行结果回灌模型的结构。
- [ ] 设计工具错误回灌模型的规则。
- [ ] 设计最大模型步数限制。
- [ ] 设计最大工具轮次限制。
- [ ] 设计单工具超时。
- [ ] 设计单 turn 超时。
- [ ] 设计外部取消语义。
- [ ] 设计事件发送顺序约束。
- [ ] 设计失败与停止原因枚举。
- [ ] 设计不可恢复错误的处理边界。
- [ ] 规定 Agent 不负责 session branch。
- [ ] 规定 Agent 不负责摘要注入。
- [ ] 规定 Agent 不负责工作区扫描。
- [ ] 补充状态机测试场景。
- [ ] 补充集成验收场景。

## 7. 测试与验收

### 单测重点

- 纯文本响应后直接结束 turn
- 单次工具调用后继续推理并完成
- 多次工具调用按串行顺序执行
- 工具失败后作为结构化结果回灌模型
- 达到步数上限或工具轮次上限后正确停止
- 外部取消和超时后正确停止并输出事件
- 生命周期事件顺序稳定

### 集成验收场景

- `AI` 层返回普通文本时，Agent 能完整结束一次 turn。
- `AI` 层触发工具调用时，Agent 能通过外部 `toolExecutor` 完成闭环。
- 在同一套事件协议下，`TUI` 可以重放一次 turn 的运行过程。

### 验收标准

- 能稳定跑通“模型输出文本结束”和“模型调工具后再继续”两条闭环。
- 工具实现不在 Agent 内部，但 Agent 能统一编排工具调用。
- session、branch、工作区上下文等产品逻辑不泄漏到 Agent 内部。

## 8. 当前非目标

- 多 Agent 协作
- 并行工具调度
- 会话持久化
- 分支摘要压缩策略
- UI 交互决策
