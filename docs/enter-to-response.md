# 从按下 Enter 到看到 response：`mypi` 全链路说明

这份文档讲的是 **当前这个仓库里的终端版聊天/agent 系统**：也就是 `mypi` 这种 **Node.js + TUI（终端界面）+ LLM 流式输出** 的形态。

如果你想直接看“按源码调用链逐帧走”的版本，可以继续看：`docs/enter-to-response-sequence.md`

如果你问的是浏览器里的聊天框，也能类比，但路径会不一样：浏览器那条链路没有 PTY/TUI，而是 DOM 事件、浏览器网络栈、前端状态管理。本文先把你现在这套系统讲透。

---

## 一句话结论

当你在 `mypi` 的聊天框里输入文本并按下 Enter 时，真正发生的不是“Node 进程直接收到一个键盘中断”，而是下面这条链路：

1. **硬件**产生按键事件；
2. **操作系统**处理硬件中断，把它变成输入事件；
3. **终端模拟器 / PTY** 再把这个输入事件翻译成字节序列；
4. **Node/libuv** 在 `stdin` 可读时收到这些字节；
5. `mypi` 的 **TUI 输入栈** 把字节解析成“Enter”；
6. **Editor** 触发提交；
7. **InteractiveApp / Agent / Session** 组装一轮对话；
8. **OpenAI Responses API** 请求发出，服务端开始生成；
9. 返回的 **流式事件** 被逐步解析成文本 / 思维摘要 / tool call；
10. **TUI 差量渲染** 把内容重新写回终端；
11. **终端模拟器** 把 ANSI 控制序列画成你看到的字符和光标。

---

## 先看总图

```text
[键盘]
  ↓
[键盘控制器 / USB HID / 中断]
  ↓
[内核输入子系统]
  ↓
[桌面系统/终端模拟器 或 SSH/tmux/WSL 中间层]
  ↓
[PTY master] -> [PTY slave = mypi 的 stdin]
  ↓
[libuv 监听可读事件]
  ↓
[ProcessTerminal]
  ↓
[StdinBuffer]
  ↓
[TUI.handleInput]
  ↓
[Editor.handleInput]
  ↓
[onSubmit -> InteractiveApp.handleSubmit]
  ↓
[AgentSession.prompt]
  ↓
[Agent._runLoop / runAgentLoop]
  ↓
[OpenAI SDK / HTTPS / TLS / Responses API]
  ↓
[流式响应事件]
  ↓
[Agent 事件 -> InteractiveApp.refresh]
  ↓
[TUI.doRender -> stdout]
  ↓
[终端模拟器解析 ANSI 并重绘]
  ↓
[屏幕上出现 response]
```

---

## 1. 硬件层：你按下 Enter 时，机器最底层发生了什么？

### 1.1 键盘本身不是直接把“字符”发给应用

你按下的不是“字符串回车”，而是一个 **物理按键**。典型过程是：

- 键盘控制器扫描键盘矩阵，发现 Enter 键闭合；
- 键盘做一次去抖（debounce）；
- 它把“某个按键被按下”的信息编码成 **scan code / HID usage**；
- 通过 USB / 蓝牙 / PS/2 / I2C 等总线送到主机。

### 1.2 操作系统先接住的是“硬件中断”

从操作系统视角，最先发生的是类似下面的事情：

- USB 主控制器或其它输入控制器收到数据；
- 控制器通过 **中断**（现代机器上常见是 MSI/MSI-X）通知 CPU；
- CPU 暂停当前执行流，跳进内核的中断处理逻辑；
- 中断上半部只做很少的事：确认设备、搬运必要状态、唤起后续处理；
- 剩余较重的工作交给下半部/softirq/workqueue/input 子系统完成。

### 1.3 但你的 `mypi` 进程并不会直接收到这个中断

这是最重要的一点：

**`mypi` 不是直接面向键盘硬件的程序。**

它通常运行在：

- 图形终端模拟器里；
- 或者远程 SSH 会话里；
- 或者 tmux/screen 里；
- 或者 WSL/ConPTY 这一类中间层里。

所以，硬件中断被内核处理后，**先变成了上层输入事件**，再被终端环境翻译成字节流，最后才到 `mypi`。

---

## 2. 终端层：为什么应用最终拿到的是 `stdin` 字节，而不是按键对象？

### 2.1 终端程序的世界，本质上是“字节流协议”

终端应用不是直接接收“KeyDown(Enter)”这样的结构体。

它拿到的是：

- `\r`
- `\n`
- `\x1b[A`
- `\x1b[13;2~`
- Kitty CSI-u 序列
- bracketed paste 包裹串

也就是说，终端世界里输入其实是一个 **控制字符/转义序列协议**。

### 2.2 在图形终端里，中间发生了“按键 -> 终端字节”的翻译

如果你是在图形终端运行 `mypi`，更真实的路径是：

- 键盘中断 -> 内核输入系统；
- Wayland/X11/macOS/Windows 的窗口系统把键盘事件交给终端模拟器；
- 终端模拟器根据当前模式，把 Enter 翻译成 `\r`、`\n` 或更复杂的序列；
- 终端模拟器把这些字节写进 **PTY master**；
- `mypi` 所在进程连接的是 **PTY slave**，于是这些字节就成了它的 `stdin`。

### 2.3 如果你在 WSL / SSH / tmux 里，链路会更长

比如你现在这个环境很像 WSL 风格路径（`/mnt/d/...`），那链路可能类似：

```text
Windows 键盘输入
  -> Windows Terminal / VS Code Terminal
  -> ConPTY / WSL 桥接
  -> Linux PTY
  -> Node.js stdin
```

如果是 SSH：

```text
本机键盘
  -> 本机终端模拟器
  -> 本机 PTY
  -> SSH 客户端加密发送
  -> 远端 sshd
  -> 远端 PTY
  -> 远端 Node.js stdin
```

所以你在 Linux 里的 `mypi`，通常看到的已经不是“原始硬件世界”，而是 **上游转译后的终端字节流**。

---

## 3. 操作系统到 Node：`mypi` 是怎么收到这些输入的？

这部分在你的代码里对应 `package/pi-tui/src/terminal.ts`。

### 3.1 `ProcessTerminal.start()` 把终端切到 raw mode

`mypi` 启动 TUI 时，会调用 `ProcessTerminal.start()`，里面做了几件关键事情：

- `process.stdin.setRawMode(true)`：开启 raw mode；
- `process.stdin.setEncoding("utf8")`；
- `process.stdin.resume()`；
- 开启 bracketed paste；
- 查询并尝试启用 Kitty keyboard protocol；
- 绑定 `stdin` 的 `data` 事件。

raw mode 很关键，因为它改变了“谁来解释 Enter / Ctrl+C”这件事。

### 3.2 raw mode 的意义：内核不再替你做“行编辑”

在 canonical/cooked mode 下：

- Enter 往往会触发行提交；
- Ctrl+C 可能直接被 TTY line discipline 变成 `SIGINT`；
- 输入会被内核缓冲到一整行再交给进程。

但在 raw mode 下：

- 每个按键尽快以字节形式交给应用；
- 应用自己处理 Enter、Backspace、Ctrl+C、方向键；
- 所以 `mypi` 才能自己实现编辑器、历史记录、补全、撤销、粘贴等功能。

### 3.3 Node 本身靠 libuv 监听 `stdin`

Node 不是忙等（busy loop）去轮询输入，而是通过 **libuv 事件循环**：

- libuv 把 `stdin` 对应的文件描述符注册到 OS 的 I/O 多路复用机制；
- Linux 下通常是 `epoll`；
- 当 PTY slave 可读时，内核把这个“可读”状态交给 libuv；
- libuv 读取字节后，Node 触发 `process.stdin.on("data", ...)`；
- `ProcessTerminal` 的处理函数拿到这段字符串。

所以，从“硬件中断”到“JS 回调被调用”之间，已经跨过了：

- 硬件中断；
- 内核输入子系统；
- 终端/PTY 转译；
- 内核 TTY/PTY 缓冲；
- libuv 事件通知；
- Node stream 层。

---

## 4. `mypi` 输入栈：字节是如何变成“提交消息”的？

这一段是你项目里最关键、也最有“系统味”的部分。

### 4.1 `ProcessTerminal` 不直接把原始 chunk 交给 UI

`stdin` 的 `data` 事件有一个坑：

**一个完整按键序列可能会被拆成多段到达。**

比如方向键、鼠标事件、Kitty 协议、粘贴包裹序列，可能会跨多个 chunk。

所以 `ProcessTerminal` 先把数据喂给 `StdinBuffer`（`package/pi-tui/src/stdin-buffer.ts`）：

- 它会缓存不完整的 escape sequence；
- 直到确认序列完整，才发出一个 `data` 事件；
- 如果是 bracketed paste，会单独发出 `paste` 事件；
- 这样上层组件看到的是“一个完整按键/完整序列”，不是半截垃圾字节。

这一步非常像网络编程里的“包重组”思想，只不过对象从 TCP 包变成了终端 escape sequence。

### 4.2 `TUI.handleInput()` 负责分发输入

`package/pi-tui/src/tui.ts` 的 `TUI.handleInput()` 会做这些事：

- 先让全局 input listeners 处理；
- 处理某些终端查询响应（比如 cell size）；
- 处理全局 debug 快捷键；
- 找到当前聚焦组件（focus component）；
- 把输入交给这个组件的 `handleInput()`。

在 `mypi` 里，焦点通常在 `Editor` 上。

### 4.3 `Editor.handleInput()` 把字节识别成语义动作

`package/pi-tui/src/components/editor.ts` 的 `Editor.handleInput()`：

- 用 keybindings + key parser 判断当前输入是啥；
- 处理删除、移动、补全、历史、粘贴、换行；
- 如果匹配 `tui.input.submit`，默认就是 Enter；
- 然后触发 `submitValue()`。

默认键位定义在 `package/pi-tui/src/keybindings.ts`：

- `tui.input.submit = enter`
- `tui.input.newLine = shift+enter`

也就是说：

- 普通 Enter = 提交
- Shift+Enter = 插入换行

### 4.4 `submitValue()` 做了什么？

`Editor.submitValue()` 不是简单回调一下而已，它还会先清理编辑器状态：

- 把大粘贴 marker 展开为真实文本；
- `trim()` 最终文本；
- 清空编辑器内容；
- 清空 paste 状态、undo 栈、滚动状态；
- 触发 `onChange("")`；
- 最后调用 `onSubmit(result)`。

这意味着：

**你看到输入框被清空，实际上是 `Editor` 在提交瞬间主动 reset 了自己的内部状态。**

---

## 5. `mypi` 应用层：提交之后，为什么会开始“跑 agent”？

这一段对应 `package/coding-agent/src/ui/interactive-app.ts`。

### 5.1 `InteractiveApp` 里，`Editor.onSubmit` 被绑定到了 `handleSubmit()`

应用启动时做了这件事：

- 给 `Editor` 安装自动补全；
- 设置 `editor.onSubmit = (...) => handleSubmit(text)`；
- 把 `header`、`status`、`transcript`、`editor` 加进 TUI；
- 订阅 agent 事件和 runtime 事件。

所以当 `Editor.submitValue()` 调用 `onSubmit` 时，真正走到的是：

```text
Editor.submitValue()
  -> InteractiveApp.handleSubmit(text)
```

### 5.2 `handleSubmit()` 做的事情

如果这条输入不是空串，它会：

1. 先把 editor 文本清空；
2. 如果是 `/command`，走命令处理；
3. 否则：
   - `editor.disableSubmit = true`
   - `refresh()` 立刻刷新 UI
   - `await session.prompt(trimmed)`

所以在你按下 Enter 之后，常见的“体感”是：

- 输入框立刻变空；
- 提交按钮/再次提交被禁用；
- 状态栏变成 streaming；
- 然后开始等待首个 response chunk。

### 5.3 注意：这里不是阻塞整个程序

虽然代码里有 `await session.prompt(...)`，但这不代表 Node 死等卡死。

真实情况是：

- 当前这段 async 函数挂起；
- 事件循环继续处理网络、输入、定时器、渲染请求；
- LLM 的流式 chunk 到来时，又会重新推进后续逻辑。

这是一个 **事件驱动 + async/await 包装的状态机**，不是“单线程死等远端返回”。

---

## 6. Session 层：你的输入如何进入“当前会话”？

这里对应：

- `package/coding-agent/src/core/agent-session.ts`
- `package/coding-agent/src/core/session-runtime.ts`
- `package/coding-agent/src/core/session-manager.ts`
- `package/coding-agent/src/core/session-context.ts`

### 6.1 `AgentSession.prompt()` 同时管两件事

`AgentSession.prompt()` 本质上做了两步：

1. `await agent.prompt(...)`
2. `await runtime.waitForSettled()`

这意味着：

- 先把消息送去 agent 跑一轮；
- 再等 runtime 把持久化、自动 compact 等尾活做完。

### 6.2 `Agent.prompt(string)` 会把纯文本包装成 `user` message

在 `package/agent/src/agent.ts` 里：

- 如果传入的是字符串；
- 它会构造成一个 `AgentMessage`：
  - `role: "user"`
  - `content: [{ type: "text", text: input }]`
  - `timestamp: Date.now()`

然后调用 `_runLoop(msgs)`。

### 6.3 `SessionRuntime` 会订阅 agent 事件，并把消息落盘

`SessionRuntime` 构造时订阅了 `agent.subscribe(...)`。

它会在不同事件上做事：

- `message_end`：把 user / assistant / toolResult 追加到 session 文件；
- `turn_end`：检查要不要 auto-compaction；
- `agent_end`：如果需要，就执行自动压缩甚至自动重试。

### 6.4 session 文件怎么存？

`SessionManager` 使用的是 **JSONL**（一行一个 JSON 对象）思路：

- 第一行是 session header；
- 后面每个 entry 是一条事件/消息；
- `appendMessage()` 最终会 `appendFile(...)` 追加到磁盘。

也就是说，你这套系统的“会话状态”不是只在内存里，它是 **一边跑一边增量持久化** 的。

这也是为什么它能支持：

- resume session
- fork branch
- tree navigation
- compaction
- session rename / label

---

## 7. Agent 层：一条消息提交后，为什么不一定只发生一次模型调用？

这里对应：

- `package/agent/src/agent.ts`
- `package/agent/src/agent-loop.ts`

### 7.1 `_runLoop()` 会构造完整的 agent 上下文

`Agent._runLoop()` 在一次 turn 开始时会准备：

- 当前 system prompt；
- 历史 messages；
- 当前可用 tools；
- thinking level；
- abort controller；
- transport / api key / budgets 等配置。

然后进入 `runAgentLoop(...)`。

### 7.2 `runAgentLoop()` 的主循环不是“只问一次模型”

它的结构大概是：

```text
加入用户消息
  -> 请求 assistant 流式输出
  -> 如果 assistant 里包含 toolCall
       -> 执行工具
       -> 把 toolResult 追加进上下文
       -> 再继续问模型
  -> 如果还有 follow-up / steering
       -> 继续下一轮
  -> 直到没有工具调用，也没有待补充消息
```

所以你按一次 Enter，后面可能发生的是：

- 1 次模型调用；
- 或者 N 次模型调用 + M 次工具执行；
- 然后才得到最终回答。

这就是 agent 系统和纯聊天系统最大的区别之一。

### 7.3 streaming 是怎么体现在内部状态上的？

`streamAssistantResponse(...)` 会消费模型流，并持续发出 agent 事件：

- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `turn_end`
- `agent_end`

这里的关键点是：

- assistant message 在“生成中”会先作为 partial message 放进上下文；
- 每个 delta 都会更新 `streamMessage`；
- UI 订阅这些事件后，就能边到边显示。

---

## 8. 模型请求层：消息如何发到 OpenAI？

这里对应：

- `package/ai/src/providers/openai-responses.ts`
- `package/ai/src/providers/openai-responses-shared.ts`

### 8.1 先把内部消息格式转成 OpenAI Responses API 的输入格式

在真正发请求前，系统会做一层消息转换：

- 把 `user` / `assistant` / `toolResult` 变成 Responses API 认识的 `input`；
- 把 tool schema 变成 OpenAI function tools；
- 把 reasoning / text / tool call 块也映射过去；
- 必要时附加 session cache key、reasoning 配置、service tier 等。

### 8.2 `client.responses.create(...)` 后，底层是标准网络栈

这一步虽然在 JS 里只是一行，但下面其实很复杂：

1. Node/OpenAI SDK 组装 HTTP 请求；
2. 如果需要，先做 DNS 解析；
3. 建立 TCP 连接；
4. 进行 TLS 握手；
5. 把请求体写进内核 socket buffer；
6. 网卡 DMA/发送队列把数据发出去；
7. OpenAI 服务端接收、排队、调度模型；
8. 服务端开始生成，并把结果以 **流式事件** 回传。

### 8.3 网络返回时，操作系统又经历了一次“中断 -> 用户态事件”

这和键盘输入很像，只是设备从键盘变成了网卡：

- 网卡收到网络包；
- 触发中断或进入 NAPI poll；
- 内核网络栈完成收包、TCP 重组、放入 socket buffer；
- libuv 发现 socket 可读；
- Node 的 TLS/HTTP/OpenAI SDK 开始解包；
- JS 层拿到一个个 `ResponseStreamEvent`。

所以从“你按 Enter”到“你看到第一个 token”，至少跨了两次重要的 I/O 链路：

- **输入链路**：键盘 -> PTY -> stdin
- **输出链路**：socket -> TLS/HTTP -> SDK stream

---

## 9. OpenAI 流如何变成 `mypi` 里的文本/思考/tool call？

### 9.1 OpenAI SDK 给的是事件流，不是一次性整段字符串

`processResponsesStream(...)` 会消费异步迭代器里的事件，例如：

- `response.created`
- `response.output_item.added`
- `response.output_text.delta`
- `response.reasoning_summary_text.delta`
- `response.function_call_arguments.delta`
- `response.completed`

### 9.2 `mypi` 把这些事件重新组装成内部 assistant message

它会把输出块逐步组装成：

- `thinking` block
- `text` block
- `toolCall` block

比如：

- 收到 `response.output_text.delta`，就把 `delta` 拼到当前 text block；
- 收到 `response.function_call_arguments.delta`，就增量解析 JSON 参数；
- 收到 `response.output_item.done`，就把这个块定稿；
- 收到 `response.completed`，就补 usage / stopReason / cost。

### 9.3 这就是为什么 UI 能“边生成边显示”

因为内部不是在等“整段字符串拼完”才更新。

而是：

- 每来一个 delta；
- agent 就发一个 `message_update`；
- UI 就申请一次 render；
- 于是你看到 response 一点点长出来。

---

## 10. UI 返回路径：response 是怎么重新回到你屏幕上的？

这里对应：

- `package/coding-agent/src/ui/interactive-app.ts`
- `package/pi-tui/src/tui.ts`

### 10.1 `InteractiveApp` 订阅 agent 事件

`InteractiveApp` 在初始化时做了：

- `session.agent.subscribe((event) => this.handleAgentEvent(event))`

所以只要 agent 有新事件：

- tool 开始执行；
- assistant stream 更新；
- agent 结束；

UI 都会收到通知。

### 10.2 `handleAgentEvent()` 最终会 `refresh()`

`refresh()` 会：

- 更新 header 文本；
- 更新 status 文本；
- 更新 transcript 文本；
- `tui.requestRender()`。

注意这里不会立刻同步重绘整个屏幕，而是 **请求一次渲染**。

### 10.3 `TUI.requestRender()` 用 `process.nextTick()` 合并多次刷新

这很重要。

如果模型 1ms 到一个 delta，而每个 delta 都完整重绘全屏，终端会很抖、很慢。

所以 `TUI.requestRender()`：

- 不会马上 render；
- 而是在 `nextTick` 里批量做一次 `doRender()`；
- 同一个 tick 里的多次更新，会尽量合并成一次屏幕刷新。

### 10.4 `TUI.doRender()` 做的是“差量渲染”，不是每次清屏重画

`doRender()` 的工作大致是：

- 重新 render 全部组件得到 `newLines`；
- 和 `previousLines` 做 diff；
- 只更新变化的那些行；
- 用 ANSI 控制序列移动光标、清行、覆盖内容；
- 用 synchronized output 减少闪烁；
- 最后把硬件光标挪到正确位置。

所以最终写到 `stdout` 的并不是“纯文本答案”，而是：

- 可见文字；
- ANSI 光标移动；
- 清屏/清行指令；
- 样式 reset；
- 光标显示/隐藏指令。

### 10.5 终端模拟器负责把这些 ANSI 序列画出来

当 `mypi` 往 `stdout` 写这些字节时：

- 内核把字节送到 PTY；
- 终端模拟器从 PTY master 读取；
- 解析 ANSI/OSC/APC/CSI 控制序列；
- 更新自己的屏幕缓冲区；
- 通知窗口系统/渲染器刷新；
- GPU/compositor 最终把字符显示到你屏幕上。

也就是说，**你“看到 response”这件事，最后完成者其实是终端模拟器，而不是 `mypi` 自己。**

`mypi` 做的是“发出正确的终端协议字节”。

---

## 11. 这套系统里，除了“问模型”，还会发生哪些额外动作？

### 11.1 工具调用（tool calls）

如果模型输出里包含 function/tool call：

- `runAgentLoop()` 会识别出这些块；
- 校验参数；
- 执行本地工具；
- 把结果包装成 `toolResult` message；
- 再继续调用模型。

所以某些 response 迟迟没“结束”，并不是卡住了，而是它在：

- 先思考；
- 再调工具；
- 再根据工具结果继续回答。

### 11.2 会话持久化

每个 message 在 `message_end` 时都会被 runtime 写进 JSONL session。

这意味着：

- user message 会被保存；
- assistant 完整消息会被保存；
- tool result 也会被保存；
- 下次 resume 时会恢复到同一条上下文分支。

### 11.3 自动 compact

`SessionRuntime` 在 `turn_end` 后会检查上下文是否太大：

- 如果超过阈值，可能触发 auto-compaction；
- compact 会生成 summary，并裁剪上下文；
- 如果是 overflow 情况，compact 完还可能自动继续一轮。

所以某些“回车后系统额外忙了一下”的体验，可能不是网络慢，而是 **会话维护逻辑** 在工作。

---

## 12. 用时间线把整个过程再串一遍

下面按“现实时间”重放一次：

### T0：你按下 Enter

- 键盘控制器检测到 Enter；
- 硬件向 CPU/内核报告输入；
- 操作系统处理键盘中断。

### T1：终端环境把它变成字节

- 终端模拟器/SSH/tmux/WSL 把 Enter 翻译成 `\r` 或其它序列；
- 写入 PTY；
- `mypi` 的 `stdin` 可读。

### T2：Node/libuv 唤醒 `mypi`

- libuv 收到 `stdin` 可读；
- `ProcessTerminal` 得到 `data`；
- `StdinBuffer` 组装完整序列；
- `TUI.handleInput()` 把它交给 `Editor`。

### T3：Editor 识别这是一次提交

- `Editor.handleInput()` 发现它匹配 `tui.input.submit`；
- 调用 `submitValue()`；
- 清空输入框；
- 触发 `onSubmit(text)`。

### T4：应用层开始一轮 turn

- `InteractiveApp.handleSubmit(text)` 被调用；
- UI 设置为 streaming / disable submit；
- 调用 `session.prompt(text)`。

### T5：Agent 组装上下文并发请求

- 用户消息被封装成 `user` message；
- 历史上下文、tools、system prompt 被收集；
- 转换成 OpenAI Responses API 所需格式；
- 通过 HTTPS 发到服务端。

### T6：服务端开始生成

- OpenAI 返回流式事件；
- Node SDK 持续读 socket；
- `processResponsesStream()` 逐步解析 delta；
- agent 发 `message_update`。

### T7：UI 边收边画

- `InteractiveApp` 收到事件后 `refresh()`；
- `TUI.requestRender()` 合并刷新请求；
- `TUI.doRender()` 只更新改动的行；
- 输出 ANSI 序列到终端。

### T8：你看到 response

- 终端模拟器解析输出；
- 屏幕刷新；
- 你看到 assistant 的文字持续长出来。

### T9：如果有工具调用，继续循环

- 模型输出 tool call；
- 本地工具执行；
- tool result 写回上下文；
- 再次请求模型；
- 最终才结束本轮 agent。

### T10：收尾

- assistant 完整消息持久化到 session；
- 可能进行 auto-compaction；
- submit 恢复可用；
- 本轮 turn 结束。

---

## 13. 几个非常容易搞混的点

### 13.1 “按键中断” 和 “Node 收到 stdin data” 不是同一个层级

- 前者发生在硬件/内核层；
- 后者发生在用户态/libuv/Node 层；
- 中间已经经过了终端协议和 PTY 抽象。

### 13.2 在 raw mode 里，`Ctrl+C` 不一定先变成 `SIGINT`

很多人以为终端里按 `Ctrl+C` 必然是信号。

但在 `mypi` 这里：

- `stdin.setRawMode(true)` 后；
- `Ctrl+C` 更多表现为一段输入；
- 然后由 TUI 自己判断它是“退出”还是“中止当前 turn”。

也就是说，它更像“应用快捷键”，不只是 shell 信号。

### 13.3 你看到“卡住”时，卡的可能不是模型

可能的阻塞点包括：

- 终端输入序列等待组包；
- DNS/TCP/TLS；
- 服务端排队；
- tool 执行；
- session 落盘；
- compaction；
- 终端重绘过慢。

### 13.4 response 出现在屏幕上，不代表 session 一定已经完全 settle

在 `mypi` 里，文本可能已经显示出来了，但 runtime 还可能在做：

- message append
- auto compact
- retry/continue

所以“用户看到答案”与“这一轮彻底收尾”不是完全同一个瞬间。

---

## 14. 如果你想把这套链路和源码一一对上，看这些文件就够了

### 输入/终端层

- `package/pi-tui/src/terminal.ts`
- `package/pi-tui/src/stdin-buffer.ts`
- `package/pi-tui/src/keys.ts`
- `package/pi-tui/src/keybindings.ts`
- `package/pi-tui/src/tui.ts`
- `package/pi-tui/src/components/editor.ts`

### 应用/UI 层

- `package/coding-agent/src/ui/interactive-app.ts`

### agent / session 层

- `package/coding-agent/src/core/agent-session.ts`
- `package/coding-agent/src/core/session-runtime.ts`
- `package/coding-agent/src/core/session-manager.ts`
- `package/coding-agent/src/core/session-context.ts`
- `package/agent/src/agent.ts`
- `package/agent/src/agent-loop.ts`

### LLM / provider 层

- `package/ai/src/providers/openai-responses.ts`
- `package/ai/src/providers/openai-responses-shared.ts`
- `package/ai/src/utils/event-stream.ts`

---

## 15. 一个更工程化的理解方式

如果你把整套系统分层，可以这样理解：

### 第 1 层：设备与内核

负责：

- 键盘中断
- 网卡中断
- PTY/socket 缓冲
- 可读/可写事件

### 第 2 层：运行时与 I/O 抽象

负责：

- libuv 事件循环
- Node stream
- TLS/HTTP client
- async iterator

### 第 3 层：终端协议与 TUI 框架

负责：

- 按键序列解析
- 聚焦组件分发
- 文本编辑行为
- 差量渲染
- ANSI 输出

### 第 4 层：agent 编排

负责：

- 历史上下文
- 模型请求
- tool call 执行
- streaming 状态更新
- abort/retry/continue

### 第 5 层：会话与产品能力

负责：

- session 持久化
- branch/tree
- rename/label
- compaction
- model/thinking 切换

你按一次 Enter，实际上是这五层在协同工作。

---

## 16. 如果你问的是“浏览器聊天框”，和这里最大的不同是什么？

如果换成浏览器聊天框：

- 输入事件来自 DOM `keydown` / `input`；
- 浏览器 renderer 进程处理键盘事件；
- 没有 PTY、没有 ANSI、没有 raw mode；
- 前端通常通过 `fetch` / `WebSocket` 发请求；
- 页面重绘由浏览器渲染引擎完成，而不是终端模拟器。

但底层仍然保留同样的“精神内核”：

- 硬件中断 -> OS 输入事件 -> 应用事件回调；
- 网络中断 -> socket 可读 -> 流式 chunk -> UI 增量更新。

只是中间的“协议栈”从 **TTY/PTY/ANSI** 换成了 **DOM/HTTP/浏览器渲染引擎**。

---

## 17. 最后的总结

把这件事说得最准确一点：

> 在 `mypi` 里，按下 Enter 之后，并不是“一个回车键直接调用了模型”。
> 它先穿过硬件中断、操作系统输入子系统、终端/PTY、Node/libuv、TUI 输入框、agent 编排器、网络协议栈、远端模型，再沿着流式事件、UI 状态更新、终端差量渲染这条路一路返回到你的屏幕。

所以你眼里看到的“按下回车 -> 返回 response”，实际上是一个横跨：

- 硬件
- 内核
- 终端协议
- Node 运行时
- 应用状态机
- 网络栈
- 远端推理服务
- 本地渲染系统

的完整分布式交互过程。

---

如果你愿意，我下一步可以继续给你写两份补充文档中的任意一份：

1. **带源码行号的精确调用链版**：从 `ProcessTerminal.start()` 一路列到 `OpenAI.responses.create()`；
2. **带时序图的操作系统版**：把中断、softirq、epoll、libuv event loop 单独展开讲。
