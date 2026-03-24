# Agent Turn Loop 设计稿

## 1. 文档定位

本文档不是 `Agent` 层的待办清单，而是当前 `MVP` 版本 `turn loop` 的设计说明。

它回答的是下面几个问题：

- 一次 `turn` 到底从哪里开始，到哪里结束
- Agent 在哪些状态之间切换
- 模型输出文本和模型请求工具时，闭环分别怎么走
- 停止原因、失败原因和事件顺序如何统一

对应的当前实现位于：

- `package/agent/src/runtime.ts`
- `package/agent/src/types.ts`

## 2. 设计目标

`Agent` 层的职责是把一次任务执行组织成一个可观察、可测试、可中断的 `turn loop`。

这一层的核心目标有四个：

- 统一一次 `turn` 的输入、输出和生命周期
- 在模型调用和工具调用之间建立稳定闭环
- 暴露稳定事件流，方便 `TUI` 或日志重放
- 把停止条件和失败条件从上层产品逻辑里剥离出来

## 3. 非目标

当前设计刻意不覆盖下面这些能力：

- session tree
- branch 恢复
- 摘要生成与摘要注入
- 工具具体实现
- 并行工具执行
- 多 Agent 协作
- UI 决策

这些都属于 `Coding-Agent` 或更上层的产品装配问题，不应该进入 `Agent` runtime。

## 4. 上下游关系

### 上游输入

上游一般是 `Coding-Agent` 层。它负责提供：

- 本次使用的 `model`
- 当前 `AIContext`
- 模型可见工具定义 `tools`
- 外部工具执行器 `toolExecutor`
- 运行时 guard，比如最大步数、超时和取消信号

### 下游依赖

下游只有两类依赖：

- 统一 `AIClient`
- 外部注入的 `ToolExecutor`

`Agent` 不依赖具体 provider，也不依赖 `TUI` 框架。

## 5. 核心接口

### `createAgentRuntime(config)`

创建一个无状态 runtime 工厂。runtime 本身不持有 session，也不缓存历史 turn。

`config` 中最关键的依赖是：

- `aiClient`
- `toolExecutor`
- `eventSink`
- 默认 guard

### `prompt(input)`

从一个全新的上下文发起一次 `turn`。

输入语义：

- `context` 是本次调用的完整消息上下文
- `tools` 是当前这次模型可见的工具集合
- `callOptions` 是底层模型调用参数
- `limits` 是本次 turn 的 guard 覆盖项

### `continue(input)`

在已有上下文后面追加消息，再发起一次新的 `turn`。

输入语义：

- 调用方要么提供 `context`
- 要么提供 `previousResult`
- 再额外提供 `appendMessages`

如果两者都没有，runtime 直接报输入错误。

## 6. 核心类型

### `TurnInput`

`TurnInput` 是单次 `turn` 的原始输入，最小字段包括：

- `model`
- `context`
- `tools`
- `callOptions`
- `limits`
- `metadata`
- `signal`

### `TurnResult`

`TurnResult` 是一次 turn 的完整收束结果，最小字段包括：

- `id`
- `state`
- `stopReason`
- `startedAt`
- `finishedAt`
- `modelSteps`
- `toolRounds`
- `text`
- `finalAssistantMessage`
- `outputContext`
- `toolExecutions`
- `events`

其中 `outputContext` 很关键，因为 `continue()` 默认就建立在它之上。

### `AgentState`

当前设计中的状态枚举如下：

- `idle`
- `model_requesting`
- `model_streaming`
- `awaiting_tool_execution`
- `finalizing`
- `completed`
- `failed`

### `StopReason`

当前统一停止原因如下：

- `completed`
- `max_model_steps`
- `max_tool_rounds`
- `cancelled`
- `turn_timeout`
- `tool_timeout`
- `failed`

这里要区分两个概念：

- `state`
  表示 runtime 最终落在 `completed` 还是 `failed`
- `stopReason`
  表示为什么结束

例如达到步数上限时，当前实现会落在 `completed`，但 `stopReason` 是 `max_model_steps`。

### `AgentEvent`

当前事件协议最小集合如下：

- `turn.started`
- `state.changed`
- `model.requested`
- `model.text.delta`
- `model.message.completed`
- `tool.started`
- `tool.completed`
- `turn.completed`
- `turn.failed`

这一层只负责结构化事件，不负责终端渲染。

## 7. 状态机设计

### 状态职责

`idle`

- turn 刚创建但还未进入模型调用
- 只在内部短暂存在

`model_requesting`

- 准备向 `AIClient` 发起新一轮请求
- 增加 `modelSteps`
- 发出 `model.requested`

`model_streaming`

- 消费 `AIClient.stream()` 的统一流式事件
- 累积文本增量
- 收集工具调用增量
- 等待 `response.completed`

`awaiting_tool_execution`

- 当前轮模型已经明确请求工具
- Agent 串行执行工具
- 把工具结果转成标准 `tool` 消息回灌上下文

`finalizing`

- turn 已满足结束条件
- 正在从运行态收束为结果对象

`completed`

- turn 正常收束
- 这里的“正常”包含完成、达到 guard、取消、超时这类可控停止

`failed`

- 出现不可恢复异常
- 输出 `turn.failed`

### 状态转换

核心转换路径如下：

```text
idle
  -> model_requesting
  -> model_streaming
    -> finalizing -> completed                 (纯文本结束)
    -> awaiting_tool_execution
      -> model_requesting                      (工具执行后继续推理)
      -> finalizing -> completed              (达到工具轮次上限/超时/取消)
    -> finalizing -> failed                   (不可恢复异常)
```

## 8. Turn Loop 主流程

### 8.1 初始化阶段

一次 `turn` 启动时，runtime 要先做四件事：

1. 创建 `turnId`
2. 合并默认 guard 和输入 guard
3. 创建本 turn 的统一取消控制器
4. 发出 `turn.started`

统一取消控制器会合并：

- 调用方传入的 `signal`
- `turnTimeoutMs`

后续模型调用和工具调用都共享这个控制器。

### 8.2 主循环

主循环按下面顺序推进：

1. 检查 turn 是否已被取消或超时
2. 检查是否达到 `maxModelSteps`
3. 进入 `model_requesting`
4. 发起模型流式请求
5. 进入 `model_streaming`
6. 组装出最终 `assistant message`
7. 如果没有工具调用，则结束 turn
8. 如果有工具调用，检查是否达到 `maxToolRounds`
9. 进入 `awaiting_tool_execution`
10. 串行执行工具并回灌结果
11. 回到下一轮模型调用

### 8.3 纯文本结束路径

当模型输出的最终 `assistant message` 不含 `toolCalls` 时：

1. 把 `assistant message` 追加到上下文
2. 发出 `model.message.completed`
3. 进入 `finalizing`
4. 进入 `completed`
5. 发出 `turn.completed`

### 8.4 工具闭环路径

当模型输出包含 `toolCalls` 时：

1. 把 `assistant message` 追加到上下文
2. 发出 `model.message.completed`
3. 增加 `toolRounds`
4. 进入 `awaiting_tool_execution`
5. 按顺序串行执行每个工具
6. 将每个工具结果转成 `tool` 消息追加到上下文
7. 工具全部执行完后，再次回到模型调用阶段

`MVP` 里多工具调用明确采用串行执行，不做并行调度。

## 9. 模型流式事件处理

当前 `Agent` 直接消费 `AI` 层统一后的流式协议。

主要关心三类事件：

- `text.delta`
- `tool-call.delta`
- `response.completed`

### 文本增量

`text.delta` 会被连续累积，并同步发出 `model.text.delta` 给上层。

### 工具调用增量

`tool-call.delta` 会按 `toolCallId` 聚合，最后形成：

- `id`
- `name`
- `arguments`

如果 provider 已经在 `response.completed` 中给出完整 `toolCalls`，则以完整结果为准。

### 完成事件

`response.completed` 到达后，runtime 组装最终的 `assistant message`。

组装原则如下：

- 如果 completion 自带完整 message，则优先使用它
- 如果 message 文本为空，但前面已经收到文本增量，则回填文本内容
- 如果 completion 没有完整工具列表，则回退到增量聚合结果

## 10. 工具执行设计

### 10.1 执行策略

工具执行器由上游注入，接口形态为：

- 输入：`callId`、`toolName`、`arguments`、解析后的 `input`
- 输出：`success` 或 `error`

当前实现会先尝试把 `arguments` 当成 JSON 解析：

- 解析成功，则把对象作为 `input`
- 解析失败，则保留原始字符串

### 10.2 串行顺序

同一轮模型请求返回多个工具时：

- 按模型给出的顺序执行
- 每个工具执行完成后立即回灌上下文
- 不等待整轮全部完成后再批量回灌

这样做的原因是：

- 更容易保证事件顺序稳定
- 更容易调试和审计
- `MVP` 阶段复杂度最低

### 10.3 回灌格式

当前工具结果通过标准 `tool` 消息回灌给模型，上下文字段包括：

- `role: "tool"`
- `name`
- `toolCallId`
- `content`
- `isError`

其中 `content` 当前采用一段 JSON 字符串文本，内容就是 `ToolExecutionResult` 本身。

这是一个刻意保守的 `MVP` 决策：

- 优点是实现简单，容易跨 provider
- 缺点是工具结果仍然是“文本承载结构化数据”，后面可能再升级

### 10.4 工具错误

如果工具执行器返回 `error` 结果：

- Agent 不直接把 turn 判为失败
- 仍然把错误结果作为 `tool` 消息回灌模型
- 由模型决定是否恢复、重试或给用户解释

这保证了“工具失败也是模型上下文的一部分”。

## 11. Guard 与停止语义

### `maxModelSteps`

检查时机在每轮循环顶部。

含义是：

- 本次 turn 最多允许发起多少轮模型请求

达到上限时：

- 不再进入下一轮模型调用
- 直接以 `stopReason = max_model_steps` 收束

### `maxToolRounds`

检查时机在模型已经明确请求工具、但还未进入新一轮工具执行之前。

含义是：

- 一个 turn 最多允许多少轮“模型请求工具 -> 工具执行 -> 再次推理”的循环

达到上限时：

- 不再执行新一轮工具
- 直接以 `stopReason = max_tool_rounds` 收束

### 外部取消

调用方可以通过 `AbortSignal` 取消 turn。

取消语义如下：

- 模型流式消费阶段可被中断
- 工具执行阶段也会收到中断信号
- 最终以 `stopReason = cancelled` 收束

### `turn_timeout`

turn 级超时由统一取消控制器负责。

超时时：

- 中断模型或工具阶段
- 最终以 `stopReason = turn_timeout` 收束

### `tool_timeout`

每个工具执行都有独立超时。

超时时：

1. 当前工具返回一个结构化错误结果
2. 该结果先被记录并回灌上下文
3. turn 以 `stopReason = tool_timeout` 收束

当前设计不在超时后继续下一轮推理。

### `failed`

只有真正的不可恢复异常才会进入 `failed`：

- 输入错误以外的未处理异常
- 模型流式协议破坏且无法恢复
- runtime 自身 bug

进入 `failed` 时：

- state 变为 `failed`
- 发出 `turn.failed`

## 12. 事件顺序约束

### 纯文本完成路径

稳定顺序如下：

1. `turn.started`
2. `state.changed` 到 `model_requesting`
3. `model.requested`
4. `state.changed` 到 `model_streaming`
5. 0 到多次 `model.text.delta`
6. `model.message.completed`
7. `state.changed` 到 `finalizing`
8. `state.changed` 到 `completed`
9. `turn.completed`

### 工具闭环路径

在上面基础上增加：

1. `state.changed` 到 `awaiting_tool_execution`
2. 对每个工具依次发出 `tool.started`
3. 对每个工具依次发出 `tool.completed`
4. 然后重新进入下一轮 `model_requesting`

### 失败路径

不可恢复异常时：

1. `state.changed` 到 `finalizing`
2. `state.changed` 到 `failed`
3. `turn.failed`

## 13. 当前测试覆盖

当前测试已经覆盖这些场景：

- 纯文本响应后直接结束
- 单次工具调用后继续推理并完成
- 多次工具调用按串行顺序执行
- 工具失败后作为结构化结果回灌模型
- 达到模型步数上限后停止
- 达到工具轮次上限后停止
- `continue()` 复用上一轮输出上下文
- 外部取消后停止
- turn 超时后停止
- tool 超时后停止

## 14. 当前未决项

虽然 `MVP` 闭环已经明确，但下面这些点还没有冻结：

- 工具结果回灌是否继续保持 JSON 文本，而不是更强类型的 payload
- `completed + stopReason != completed` 这种表示是否保留，还是未来增加 `stopped` 状态
- 是否需要补充更细的模型流式事件，比如 tool call 增量事件直接透出给上层
- 工具超时后是否允许继续把超时结果交给模型再推理一轮
- 是否引入可恢复错误重试策略
- 是否允许并行工具调度

## 15. 一句话总结

当前 `Agent` 的 `turn loop` 设计已经满足 `MVP` 闭环要求：

- 文本路径可直接完成
- 工具路径可串行闭环
- 停止原因和事件生命周期统一
- session / branch / UI 等上层语义没有泄漏进 runtime
