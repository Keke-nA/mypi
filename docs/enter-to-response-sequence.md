# 从按下 Enter 到看到 response：源码锚点版时序图

这份文档是 `docs/enter-to-response.md` 的补充版。

- 上一篇偏“系统全景”；
- 这一篇偏“按源码调用链逐帧走读”。

建议两篇配合看：

- 总览版：`docs/enter-to-response.md`
- 源码锚点版：`docs/enter-to-response-sequence.md`

---

## 0. 先给出最短调用链

```text
你按 Enter
  -> PTY/stdin 可读
  -> ProcessTerminal 收到 data
  -> StdinBuffer 组出完整按键序列
  -> TUI.handleInput()
  -> Editor.handleInput()
  -> Editor.submitValue()
  -> InteractiveApp.handleSubmit()
  -> AgentSession.prompt()
  -> Agent.prompt()
  -> runAgentLoop()
  -> streamAssistantResponse()
  -> streamOpenAIResponses()
  -> OpenAI responses.create(...)
  -> processResponsesStream()
  -> agent message_update / message_end
  -> InteractiveApp.refresh()
  -> TUI.requestRender()
  -> TUI.doRender()
  -> stdout -> 终端重绘
```

对应源码入口：

- `package/pi-tui/src/terminal.ts:69`
- `package/pi-tui/src/stdin-buffer.ts:243`
- `package/pi-tui/src/tui.ts:482`
- `package/pi-tui/src/components/editor.ts:519`
- `package/pi-tui/src/components/editor.ts:1163`
- `package/coding-agent/src/ui/interactive-app.ts:150`
- `package/coding-agent/src/core/agent-session.ts:55`
- `package/agent/src/agent.ts:293`
- `package/agent/src/agent-loop.ts:79`
- `package/agent/src/agent-loop.ts:207`
- `package/ai/src/providers/openai-responses.ts:62`
- `package/ai/src/providers/openai-responses-shared.ts:290`
- `package/pi-tui/src/tui.ts:464`
- `package/pi-tui/src/tui.ts:873`

---

## 1. 时序图

```text
┌────────┐   ┌────────────────┐   ┌─────┐   ┌───────────────┐   ┌───────┐   ┌────────┐   ┌────────┐
│ Keyboard│   │ Terminal / PTY │   │Node │   │ pi-tui / Editor│   │ App   │   │ Agent  │   │ OpenAI │
└────┬───┘   └──────┬─────────┘   └──┬──┘   └──────┬────────┘   └──┬────┘   └──┬─────┘   └──┬─────┘
     │              │                │             │                 │             │            │
     │ Enter        │                │             │                 │             │            │
     ├─────────────>│                │             │                 │             │            │
     │              │ 写入 PTY       │             │                 │             │            │
     │              ├───────────────>│ stdin data  │                 │             │            │
     │              │                ├────────────>│ StdinBuffer     │             │            │
     │              │                │             ├───────────────>│ TUI.handle  │            │
     │              │                │             ├───────────────>│ Editor.handle│           │
     │              │                │             │ submitValue()   │             │            │
     │              │                │             ├────────────────>│ handleSubmit │            │
     │              │                │             │                 ├────────────>│ prompt()   │
     │              │                │             │                 │             ├───────────>│ responses.create
     │              │                │             │                 │             │ <stream>    │
     │              │                │             │                 │             │<───────────┤ delta/event
     │              │                │             │                 │<────────────┤ message_update
     │              │                │             ├───────────────>│ refresh()   │            │
     │              │                │             ├───────────────>│ requestRender│           │
     │              │                │             ├───────────────>│ doRender()  │            │
     │              │ <──────────────┤ stdout/ANSI │                 │             │            │
     │ 屏幕看到 response│                │             │                 │             │            │
```

这个图里最容易忽略的一点是：

- 代码里从 Enter 到 response 是一条链；
- 但操作系统里其实有两条 I/O 通道在交替驱动它：
  - **输入通道**：键盘 -> PTY -> stdin
  - **输出通道**：socket -> SDK stream -> stdout -> 终端

---

## 2. 启动前置：为什么按键能被应用自己接管？

这一段不是“按下 Enter 的瞬间”，但它决定了后面所有行为。

### 帧 A：TUI 启动，终端进入 raw mode

关键入口：

- `package/coding-agent/src/ui/interactive-app.ts:118`
- `package/pi-tui/src/tui.ts:413`
- `package/pi-tui/src/terminal.ts:69`

发生的事情：

1. `InteractiveApp.start()` 调用 `this.tui.start()`；
2. `TUI.start()` 调用 `terminal.start(onInput, onResize)`；
3. `ProcessTerminal.start()` 把 `stdin` 切到 raw mode；
4. 启用 bracketed paste；
5. 查询 Kitty keyboard protocol；
6. 绑定 `stdin` 的 `data` 事件。

关键影响：

- Enter 不再由内核行缓冲“代替你提交一整行”；
- Ctrl+C 也不一定先变成 `SIGINT`；
- 应用开始自己解释每个按键。

如果没有这一步，后面的 `Editor.handleInput()` 根本接不到你逐键输入的字节。

---

## 3. 输入链路：Enter 进入 Node 之后的第一跳

### 帧 1：终端把 Enter 写入 `stdin`

代码入口：

- `package/pi-tui/src/terminal.ts:69`
- `package/pi-tui/src/terminal.ts:113`

真实世界对应：

- 键盘中断 -> 输入子系统 -> 终端模拟器/PTY；
- PTY slave 对 Node 来说就是 `stdin`；
- libuv 发现可读后，把数据交给 `process.stdin.on("data")`。

代码里，`ProcessTerminal.start()` 并不直接把 chunk 交给 UI，而是先交给 `StdinBuffer`。

### 帧 2：`StdinBuffer` 负责把半截转义序列拼完整

代码入口：

- `package/pi-tui/src/stdin-buffer.ts:243`
- `package/pi-tui/src/stdin-buffer.ts:255`
- `package/pi-tui/src/stdin-buffer.ts:354`

它处理的问题是：

- 一个按键序列可能被拆成多个 `stdin` chunk；
- escape sequence、CSI-u、paste marker 都可能跨 chunk；
- 如果不先组包，上层会把半截序列误判成普通字符。

所以这里相当于做了一个“终端输入层的小协议解包器”。

对 Enter 而言，通常比较简单，常见会是：

- `\r`
- `\n`
- 某些终端下的增强序列

但 `mypi` 仍然统一通过 `StdinBuffer` 走一遍，这样行为一致。

---

## 4. TUI 分发：输入从“字节”变成“交给当前焦点组件”

### 帧 3：`TUI.handleInput()` 分发给聚焦组件

代码入口：

- `package/pi-tui/src/tui.ts:482`

这里做了几层判断：

1. 先经过全局 `inputListeners`；
2. 如果正在等待终端响应，先解析响应；
3. 再看当前是否有 focused component；
4. 最后把数据交给 `focusedComponent.handleInput(data)`。

在聊天界面里，焦点通常已经在 `Editor`：

- `package/coding-agent/src/ui/interactive-app.ts:78`

所以这一跳之后，Enter 会进入 `Editor.handleInput()`。

---

## 5. 编辑器层：Enter 被解释为“提交”，不是“插入换行”

### 帧 4：`Editor.handleInput()` 判定这是 submit

代码入口：

- `package/pi-tui/src/components/editor.ts:519`
- `package/pi-tui/src/keybindings.ts:118`
- `package/pi-tui/src/keybindings.ts:119`

默认绑定是：

- `shift+enter` -> `tui.input.newLine`
- `enter` -> `tui.input.submit`

所以 `Editor.handleInput()` 的逻辑是：

- 如果是 newline 相关序列，插入换行；
- 如果是 submit，调用 `submitValue()`；
- 如果前一个字符是 `\`，还有一个兼容逻辑会把 Enter 改写成换行。

### 帧 5：`submitValue()` 生成最终提交文本

代码入口：

- `package/pi-tui/src/components/editor.ts:1163`

这里会：

1. 把 paste marker 展开回真实内容；
2. `trim()` 得到最终提交文本；
3. 清空编辑器内部状态；
4. 清空 undo/paste/history 浏览态；
5. 调用 `onSubmit(result)`。

这里很关键：

**输入框之所以会立刻清空，不是服务端返回了，而是本地编辑器已经先 reset 了。**

---

## 6. 应用层：提交消息后，聊天 UI 立即进入“本轮处理中”

### 帧 6：`InteractiveApp` 接住提交事件

代码入口：

- `package/coding-agent/src/ui/interactive-app.ts:71`
- `package/coding-agent/src/ui/interactive-app.ts:150`

绑定关系是：

```text
Editor.onSubmit = (text) => handleSubmit(text)
```

`handleSubmit()` 的主流程：

1. 忽略空输入；
2. 立刻 `editor.setText("")`；
3. 如果是 `/command`，走命令分支；
4. 否则：
   - `editor.disableSubmit = true`
   - `refresh()`
   - `await session.prompt(trimmed)`

所以在首个 response 到来之前，UI 已经会先做一次刷新：

- 输入框空了；
- submit 被禁用；
- streaming 状态可能改变；
- transcript 还没长，但应用已经进入“处理中”。

---

## 7. Session 包装层：一次 prompt 不只是模型调用，还包括会话落盘与收尾

### 帧 7：`AgentSession.prompt()` 把 agent 和 runtime 串起来

代码入口：

- `package/coding-agent/src/core/agent-session.ts:55`

它不是单纯代理 `agent.prompt()`，而是：

```text
await agent.prompt(...)
await runtime.waitForSettled()
```

这个设计的意义是：

- 前半段负责“跑对话本身”；
- 后半段负责“等 session runtime 把持久化、auto-compaction 等尾活做完”。

所以从 API 语义上，`session.prompt()` 比 `agent.prompt()` 更接近“这一轮彻底完成”。

---

## 8. Agent 入口：字符串输入被包装成 `user` message

### 帧 8：`Agent.prompt()` 生成用户消息并进入 `_runLoop()`

代码入口：

- `package/agent/src/agent.ts:293`

如果你传的是普通字符串，它会包装成：

- `role: "user"`
- `content: [{ type: "text", text: input }]`
- `timestamp: Date.now()`

然后进入 agent 主循环。

### 帧 9：`_runLoop()` 建立本轮上下文

相关入口：

- `package/agent/src/agent.ts:448`

这里会准备：

- 当前 model；
- system prompt；
- 已有消息历史；
- tools；
- thinking level；
- abort controller；
- API key / transport / budgets；
- streaming 状态。

这一步之后，agent 从“静态会话对象”进入“一次正在运行的 turn”。

---

## 9. Agent 主循环：先发 user，再拉 assistant 流

### 帧 10：`runAgentLoop()` 先发 `message_start/end`，再请求 assistant

代码入口：

- `package/agent/src/agent-loop.ts:79`

`runAgentLoop()` 的一开始并不会马上调模型，而是：

1. `emit({ type: "agent_start" })`
2. `emit({ type: "turn_start" })`
3. 对用户消息依次发：
   - `message_start`
   - `message_end`
4. 然后进入 `runLoop(...)`

这意味着：

- user message 会先进入 agent 的状态流；
- UI 和 runtime 都有机会在模型返回前先看到这条 user 消息。

### 帧 11：`streamAssistantResponse()` 开始消费模型流

代码入口：

- `package/agent/src/agent-loop.ts:207`

它会做几件事：

1. 先把当前上下文转成 LLM 所需格式；
2. 调用 provider stream function；
3. `for await` 消费流式事件；
4. 按事件类型发 `message_start/update/end`。

这里是“agent 层”和“provider 层”的分界点。

---

## 10. Provider 层：真正发出 OpenAI 请求

### 帧 12：`streamOpenAIResponses()` 建立 OpenAI 流

代码入口：

- `package/ai/src/providers/openai-responses.ts:62`

这一层做的事情：

1. 创建 OpenAI client；
2. 用上下文构造 Responses API 参数；
3. 调用 `client.responses.create(params, ...)`；
4. 立刻往上游推一个 `start` 事件；
5. 再调用 `processResponsesStream(...)` 去持续消费远端事件。

从操作系统视角，这一步底下对应的是：

- DNS
- TCP
- TLS
- HTTP 请求发送
- socket 可读事件

也就是说，**第二条 I/O 链路从这里开始接管：网络栈开始驱动本轮对话。**

### 帧 13：`processResponsesStream()` 把 OpenAI 事件还原成内部块

代码入口：

- `package/ai/src/providers/openai-responses-shared.ts:290`
- `package/ai/src/providers/openai-responses-shared.ts:372`
- `package/ai/src/providers/openai-responses-shared.ts:461`

它按事件类型增量构造：

- `thinking` block
- `text` block
- `toolCall` block

典型路径：

1. `response.output_item.added` -> 新建 block；
2. `response.output_text.delta` -> 往 text block 追加字符；
3. `response.function_call_arguments.delta` -> 增量 JSON 解析；
4. `response.output_item.done` -> block 定稿；
5. `response.completed` -> usage/cost/stopReason 定稿。

所以“一个回答逐字长出来”的根源就在这里。

---

## 11. 事件回流：provider 的 delta 怎么一路回到 UI？

### 帧 14：provider event -> agent `message_update`

代码入口：

- `package/agent/src/agent-loop.ts:207`

`streamAssistantResponse()` 每收到一次 provider event：

- 更新 partial assistant message；
- 覆盖上下文中最后一条 partial assistant；
- 发出 `message_update`。

当结束时：

- 取 `response.result()` 得到最终 assistant message；
- 发 `message_end`；
- 返回这条完成消息给主循环。

### 帧 15：`Agent` 把 loop event 映射到自身状态

相关入口：

- `package/agent/src/agent.ts:367`

`Agent._processLoopEvent()` 会同步更新：

- `streamMessage`
- `messages`
- `pendingToolCalls`
- `isStreaming`
- `error`

然后把事件再广播给订阅者。

这一步让 UI 和 SessionRuntime 不需要理解 provider 细节，只要订阅 agent 事件就行。

---

## 12. UI 更新：为什么 response 会边到边显示？

### 帧 16：`InteractiveApp.handleAgentEvent()` 收到事件后刷新

代码入口：

- `package/coding-agent/src/ui/interactive-app.ts:134`

它对不同事件做不同事情：

- tool 开始执行时加 notice；
- assistant 出错时加 error notice；
- `agent_end` 时恢复 submit；
- 最后统一 `refresh()`。

### 帧 17：`refresh()` 更新文本组件并申请 render

相关入口：

- `package/coding-agent/src/ui/interactive-app.ts:385`
- `package/coding-agent/src/ui/interactive-app.ts:470`

`refresh()` 会更新：

- header
- status
- transcript

然后调用：

- `this.tui.requestRender()`

### 帧 18：`requestRender()` 把多个刷新合并到下一个 tick

代码入口：

- `package/pi-tui/src/tui.ts:464`

这里的关键不是“立刻 render”，而是：

- 只要还没排队，就在 `process.nextTick(...)` 里安排一次 `doRender()`；
- 同一个事件循环周期里的多次 `refresh()` 会被合并。

这就是流式输出看起来既连续、又没有疯狂闪烁的重要原因之一。

---

## 13. 真正写屏：TUI 怎样把新内容画到终端上？

### 帧 19：`doRender()` 做差量渲染

代码入口：

- `package/pi-tui/src/tui.ts:873`

它的大致流程：

1. render 所有组件，得到 `newLines`；
2. 叠 overlays；
3. 抽出光标位置 marker；
4. 与 `previousLines` 做 diff；
5. 尽量只更新变化的行；
6. 用 ANSI 控制序列移动光标、清行、重写内容；
7. 把整段 buffer 一次性写到终端。

所以 `mypi` 不是每个 token 都“清屏重画一遍”，而是尽量做局部更新。

### 帧 20：`positionHardwareCursor()` 让 IME/光标位置保持正确

代码入口：

- `package/pi-tui/src/tui.ts:1193`

它会根据渲染出来的 cursor marker：

- 计算目标行列；
- 发 ANSI 光标定位；
- 显示或隐藏硬件光标。

这一步解释了为什么一个终端 TUI 还能把输入法候选框放在正确位置。

### 帧 21：终端模拟器最终完成可视化

这一帧不在仓库代码里，但它是真正的最后一跳：

- `ProcessTerminal.write()` 往 `stdout` 写字节；
- PTY/终端模拟器收到这些字节；
- 终端模拟器解析 ANSI；
- 更新自己的屏幕缓冲区；
- 最终你看到 response。

---

## 14. 会话落盘：为什么消息能被 resume？

### 帧 22：`SessionRuntime` 订阅 agent 事件并持久化

代码入口：

- `package/coding-agent/src/core/session-runtime.ts:420`
- `package/coding-agent/src/core/session-runtime.ts:428`

`SessionRuntime.handleAgentEvent()` 的关键逻辑：

- `message_end`：把 user/assistant/toolResult 追加到 session；
- `turn_end`：决定要不要 auto-compaction；
- `agent_end`：必要时执行 auto-compaction 和 retry。

### 帧 23：`SessionManager.appendMessage()` 追加 JSONL entry

代码入口：

- `package/coding-agent/src/core/session-manager.ts:432`

这里会：

- 生成 entry id；
- 记录 `parentId`；
- 更新 `leafId`；
- 如果当前 session 有文件路径，就 `appendFile(...)` 追加到 JSONL。

这解释了为什么这套系统能：

- resume
- tree/fork
- compaction
- label/name

因为它从一开始就不是“纯内存对话框”，而是“事件日志式会话系统”。

---

## 15. 如果 assistant 中途发了 tool call，会岔出哪条支线？

### 帧 24：主循环识别 `toolCall` 块

相关入口：

- `package/agent/src/agent-loop.ts:114`
- `package/agent/src/agent-loop.ts:250`

当 assistant message 里带有 `toolCall`：

1. `runLoop()` 识别出 tool calls；
2. 执行 `executeToolCallsSequential()` 或 `executeToolCallsParallel()`；
3. 生成 `toolResult` message；
4. 把结果插入上下文；
5. 再继续下一次 `streamAssistantResponse()`。

所以一次 Enter，最终可能经历的是：

```text
user -> assistant(partial/toolcall) -> toolResult -> assistant(final)
```

而不是单次问答。

---

## 16. 这条链路里，操作系统真正“介入”的几个点

如果你想把源码和 OS 概念硬对齐，可以用下面这张表：

| OS/运行时概念 | 在这套代码里的第一个可见锚点 |
|---|---|
| 键盘输入已到 PTY/stdin | `package/pi-tui/src/terminal.ts:69` |
| `stdin` 字节组包 | `package/pi-tui/src/stdin-buffer.ts:255` |
| UI 输入分发 | `package/pi-tui/src/tui.ts:482` |
| 应用层提交 | `package/coding-agent/src/ui/interactive-app.ts:150` |
| 网络请求发出 | `package/ai/src/providers/openai-responses.ts:62` |
| 网络流事件解包 | `package/ai/src/providers/openai-responses-shared.ts:290` |
| stdout 终端重绘 | `package/pi-tui/src/tui.ts:873` |

也就是说：

- **硬件中断本身** 不会在 JS 代码里直接出现；
- JS 能看到的，是“内核 + PTY + libuv 已经把它变成了可读事件”。

---

## 17. 你可以怎么自己单步追这条链？

如果你后面想自己继续深挖，我建议按下面顺序读代码：

### 路线 A：从键盘往下追

1. `package/pi-tui/src/terminal.ts:69`
2. `package/pi-tui/src/stdin-buffer.ts:255`
3. `package/pi-tui/src/tui.ts:482`
4. `package/pi-tui/src/components/editor.ts:519`
5. `package/pi-tui/src/components/editor.ts:1163`
6. `package/coding-agent/src/ui/interactive-app.ts:150`

### 路线 B：从提交往模型追

1. `package/coding-agent/src/core/agent-session.ts:55`
2. `package/agent/src/agent.ts:293`
3. `package/agent/src/agent-loop.ts:79`
4. `package/agent/src/agent-loop.ts:207`
5. `package/ai/src/providers/openai-responses.ts:62`
6. `package/ai/src/providers/openai-responses-shared.ts:290`

### 路线 C：从 response 往屏幕追

1. `package/coding-agent/src/ui/interactive-app.ts:134`
2. `package/coding-agent/src/ui/interactive-app.ts:470`
3. `package/pi-tui/src/tui.ts:464`
4. `package/pi-tui/src/tui.ts:873`
5. `package/pi-tui/src/tui.ts:1193`

---

## 18. 最后再压缩成一句话

如果只保留一句最精确的话，可以这样记：

> 你按下 Enter 之后，`mypi` 先通过 PTY/stdin 收到终端字节，再由 `Editor` 解释成 submit，随后 `InteractiveApp` 触发 `AgentSession.prompt()`；agent 通过 OpenAI Responses API 拉取流式事件，再把这些事件逐步回灌到 TUI 的差量渲染器里，最终由终端模拟器把 ANSI 输出画成你看到的 response。

这句话把：

- OS 输入
- Node 事件循环
- TUI 输入框
- agent 编排
- 模型流
- 终端渲染

六段都连起来了。
