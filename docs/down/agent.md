# Agent 层说明

对应代码：

- `package/agent/src`
- 包名：`@mypi/agent`

---

## 0. 最小使用方式

`agent` 层也是一个库，不是单独 CLI。最简单的使用方式是在代码里创建一个 `Agent` 实例。

最小示例：

```ts
import { getModel } from "@mypi/ai";
import { Agent } from "@mypi/agent";

const agent = new Agent({
  getApiKey: async () => process.env.OPENAI_API_KEY,
});

agent.setModel(getModel("openai", "gpt-5.4"));
agent.setSystemPrompt("You are a coding assistant.");
agent.setTools([]);

await agent.prompt("Summarize the repository.");

console.log(agent.state.messages);
```

如果想监听运行过程，可以订阅：

```ts
agent.subscribe((event) => {
  console.log(event.type);
});
```

不过在真实产品里，`Agent` 一般不会裸用，而是会被更上层的：

- `AgentSession`
- `mom` 的 `AgentRunner`

继续包装。

---

## 1. 这一层是干什么的

如果说 `ai` 层解决的是“怎么调用模型”，那么 `agent` 层解决的就是：

> “怎么把一次用户输入跑成完整的一轮 Agent 行为。”

这里的一轮，不只是一次模型回复，而是可能包含：

- 模型先输出文本
- 模型发出一个或多个 tool call
- 工具被执行
- 工具结果再喂回模型
- 模型继续输出
- 最终停在一个真正完成的 assistant message 上

也就是说，`agent` 层是整个项目的 **单 Agent 编排层**。

---

## 2. 这一层对外提供什么

入口在：`package/agent/src/index.ts`

当前最重要的对外内容有：

- `Agent`
- `agentLoop(...)`
- `agentLoopContinue(...)`
- `runAgentLoop(...)`
- `runAgentLoopContinue(...)`
- `streamProxy(...)`
- 各类 `Agent*` 类型定义

其中最核心的是：

### `Agent`
这是上层最常直接用到的类。

### `runAgentLoop(...)`
这是底层真正的执行主循环。

### `AgentTool`
这是工具契约。

---

## 3. `Agent` 类到底提供什么能力

代码位置：`package/agent/src/agent.ts`

`Agent` 本质上是一个带状态、带事件、带队列的单 Agent 运行时壳子。

### 主要能力

- 持有当前 agent state
- 持有模型、system prompt、tools、messages
- 发起 `prompt(...)`
- 发起 `continue()`
- 支持 `abort()`
- 支持 `steer(...)`
- 支持 `followUp(...)`
- 对外发送 `AgentEvent`
- 管理工具执行模式（串行/并行）

### 关键状态

`AgentState` 包括：

- `systemPrompt`
- `model`
- `thinkingLevel`
- `tools`
- `messages`
- `isStreaming`
- `streamMessage`
- `pendingToolCalls`
- `error`

这说明 `Agent` 不是一个纯函数，而是一个真正的运行时对象。

---

## 4. 这一层的核心抽象：Agent 不直接“懂业务”

`Agent` 本身并不懂：

- Slack
- session 文件
- branch tree
- 工作区路径
- 哪些工具该给用户

它只要求上层提供：

- 当前模型
- system prompt
- messages
- tools
- 把内部消息转成 LLM message 的方式

这也是 `AgentOptions` 里这些可注入项存在的原因：

- `convertToLlm`
- `transformContext`
- `getApiKey`
- `beforeToolCall`
- `afterToolCall`
- `toolExecution`
- `streamFn`

所以这层的角色很准确：

> “一个可复用的、可插拔的单 Agent turn loop 运行时。”

---

## 5. tool contract 是什么

代码位置：`package/agent/src/types.ts`

### `AgentTool`
每个工具必须提供：

- `name`
- `label`
- `description`
- `parameters`
- `execute(...)`

其中 `parameters` 是 schema，`execute(...)` 会真正跑工具。

### 工具返回值

工具返回 `AgentToolResult`，核心包括：

- `content`
- `details`

然后会被包装成统一的 `toolResult` message，再喂回模型。

### 一个关键点

`agent` 层只负责：

- 验证参数
- 执行工具
- 把结果回灌

它不负责定义具体的 `read/write/edit/bash` 行为。那是 `coding-agent` 和 `mom` 这类上层产品去决定的。

---

## 6. turn loop 是怎么跑的

核心代码在：`package/agent/src/agent-loop.ts`

可以把这层的主循环理解成：

```text
接收 prompt
  -> 放进 context.messages
  -> 调 ai.streamSimple(...)
  -> 一边收 assistant 流式事件，一边更新 partial message
  -> assistant 结束后，看是否包含 tool call
  -> 如果有 tool call，就执行工具
  -> 把 toolResult 追加回 context
  -> 再次调用模型
  -> 直到没有 tool call 且没有 follow-up
  -> 发出 agent_end
```

### 更具体地说

`runLoop(...)` 中有两个关键层次：

#### 第一层：assistant turn
先向模型请求一次 assistant 输出。

#### 第二层：tool closure
如果 assistant 包含 tool call，就执行工具，再继续下一轮 assistant。

也就是说，一次 `prompt(...)` 不等于“一次模型调用”，而是：

> “直到这一轮逻辑闭环结束为止”。

---

## 7. `steer` 和 `followUp` 是什么

这是这一层比较有意思的设计点。

### `steer`
表示：

- 在当前运行过程中插入新的 steering message
- 更像“给当前 agent 追加方向修正”

### `followUp`
表示：

- 在当前这轮结束后，继续追加新的用户消息
- 更像“同一个会话里的后续发言”

并且二者都支持两种模式：

- `all`
- `one-at-a-time`

这为 `mom` 那种“Slack 同一频道里运行中又来新消息”的场景提供了很好的基础。

---

## 8. 事件系统：上层为什么能做流式 UI 和 thread 日志

`Agent` 会发出 `AgentEvent`。

这些事件包括：

- `agent_start / agent_end`
- `turn_start / turn_end`
- `message_start / message_update / message_end`
- `tool_execution_start / tool_execution_update / tool_execution_end`

这意味着上层可以不去猜内部状态，而是直接订阅事件，做：

- CLI 文本流式输出
- TUI 动态渲染
- Slack thread tool 日志
- usage 统计
- 持久化

这也是为什么 `coding-agent` 的 `SessionRuntime` 能订阅 `Agent` 并把消息写进 session file。

---

## 9. 工具执行有两个关键钩子

### `beforeToolCall`
在工具真正执行前触发。

可用于：

- 参数审查
- 拦截危险命令
- 条件阻止执行

### `afterToolCall`
在工具执行后触发。

可用于：

- 重写结果
- 补充 details
- 修改 isError

这让上层产品不用修改 Agent 主循环，也能做更细粒度的策略控制。

---

## 10. `streamProxy` 是什么

代码位置：`package/agent/src/proxy.ts`

这是一个额外提供的代理流适配层。

它的作用不是本地主线运行时必须依赖，而是：

- 从远端 proxy 接受流式事件
- 重新恢复成标准 `AssistantMessageEventStream`

所以它说明了一点：

> `agent` 层并不强绑定“模型一定要本地直连 API”，它也可以吃一个标准代理流。

不过这不是当前 `mypi` 主路径的重点。

---

## 11. 这一层不负责什么

这一层明确不负责：

- session 持久化
- branch tree
- fork / navigate
- workspace tools 定义
- CLI/TUI 界面
- Slack transport
- attachments 下载上传
- 项目配置加载

所以 `agent` 层虽然重要，但它仍然只是“编排核心”，还不是完整产品层。

---

## 12. 当前可以怎么总结这层

如果面试时要一句话介绍，我会这么说：

> `@mypi/agent` 是一层事件驱动的单 Agent orchestrator。它建立在统一的 AI event stream 之上，负责把用户消息、assistant 流式输出、tool calls、tool results 组织成完整 turn loop，并通过 `AgentEvent` 把运行过程暴露给更上层的 session、CLI、TUI 或 Slack runtime。

---

## 13. 关键代码位置

- `package/agent/src/agent.ts`
- `package/agent/src/agent-loop.ts`
- `package/agent/src/types.ts`
- `package/agent/src/proxy.ts`
