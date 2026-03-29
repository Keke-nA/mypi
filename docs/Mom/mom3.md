# Mom 进度记录（三）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的下一轮推进：**tool 线程日志**。

这一轮的目标是把工具执行过程从“只有最终结果”推进到“在 Slack 里可观察、可回看、可调试”。

---

## 1. 本轮目标

在 `mom2.md` 之后，`mom` 已经具备：

- Slack 文本对话
- 同窗口 follow-up 顺序处理
- sandbox
- 基础工具调用
- 附件输入链路

但还缺一个很关键的产品能力：

> 用户只能看到最终答复，不容易看清 bot 中间到底做了什么。

因此这一轮的目标是：

- 保持主消息简洁
- 把工具执行细节放到该次回复对应的 Slack thread 中

---

## 2. 什么是 tool 线程日志

当前实现的语义不是单独搞一个全局“日志频道”，而是：

- 每次 bot 生成一条主回复消息
- 这条主回复下面再挂一个 Slack thread
- thread 中记录本次 run 的工具执行过程

也就是：

- **主消息**：给用户看的简洁结论
- **thread**：给开发 / 调试看的过程细节

---

## 3. 本轮改动

### 3.1 `slack.ts`

已新增：

- `postThreadMessage(channel, threadTs, text)`

这使得 `mom` 已经可以往某条主消息下面继续发 thread 消息。

### 3.2 `main.ts`

已把 thread 能力暴露给 runner：

- `RunnerContext.postThreadMessage(text)`

同时沿用了当前主消息占位逻辑：

- 如果主消息还没创建，会先确保 `_Thinking..._` 已经发出
- thread 日志始终挂在当前这条主回复下面

### 3.3 `agent.ts`

已接入 tool 事件到 Slack thread：

- 监听 `tool_execution_start`
- 监听 `tool_execution_end`

并且做了以下事情：

#### 工具开始时
会在 thread 里发一条消息，包含：

- tool name
- label
- 参数摘要

#### 工具结束时
会在同一个 thread 里再发一条消息，包含：

- 成功 / 失败状态
- tool name
- label
- 耗时
- 结果摘要

### 3.4 当前日志绑定方式

thread 日志不是全局乱发，而是**绑定到当前正在处理的那条主回复**。

这意味着：

- 初始消息的工具日志挂在初始回复下面
- follow-up 消息的工具日志挂在 follow-up 自己对应的回复下面
- 不同消息之间不会把 thread 混在一起

这一步对于 follow-up 场景尤其关键。

---

## 4. 当前 thread 日志内容

当前已经包含：

### 4.1 start 日志

示意形式：

```text
→ read — read package.json

{ ...args }
```

### 4.2 end 日志

示意形式：

```text
✓ read — read package.json (0.1s)

{ ...result }
```

如果失败，则会变成类似：

```text
✗ bash — run npm run typecheck (2.3s)

error output...
```

---

## 5. 当前实现细节

### 5.1 参数和结果会被截断

为了避免 Slack thread 被超长单条消息打爆，当前已经对：

- tool 参数
- tool 结果

做了更激进的 thread 截断。

当前采用的是：

- **按字符数截断**
- **按行数截断**
- 截断后追加显式标记：`[truncated for Slack thread]`

也就是说，thread 现在不会再把完整 stdout / 文件内容原样全部摊开，而是只展示一个足够用于判断上下文的摘要片段。

### 5.2 主消息和 thread 的职责分离

当前策略是：

- **主消息**：仍然保留最终答复
- **thread**：承载工具 start/end 细节

这样做的好处是：

- 频道主界面不容易刷屏
- 需要时又可以点进 thread 看完整过程
- 更接近上游 mom 的可用体验

---

## 6. 这一步解决了什么问题

这一轮完成后，`mom` 在实际使用里会明显更容易调试和观察：

### 6.1 知道它做了什么

现在你可以看到：

- 它调用了哪些工具
- 调用顺序是什么
- 每个工具用了多久
- 每个工具是成功还是失败

### 6.2 不必把所有过程塞进主消息

如果没有 thread 日志，要么：

- 主消息特别脏
- 要么中间过程完全不可见

现在这两者之间有了更合理的平衡。

### 6.3 更适合长任务和问题排查

比如：

- 跑 bash
- 读多个文件
- 连续 edit / write

现在都可以在 thread 里回看，而不是只剩一句“我已经做完了”。

---

## 7. 当前状态总结

截至 `mom3.md` 记录点，`mom` 已经具备：

- Slack 接入
- 文本对话
- 同窗口 follow-up 顺序处理
- 基础工具调用
- sandbox
- 输出附件链路
- 输入附件链路
- 图片输入
- tool 线程日志

当前仍未完成的重点包括：

- skills
- backfill
- events
- usage summary
- `[SILENT]` 等更完整的输出编排细节

---

## 8. 验证结果

已完成：

- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 mom 改动无关

建议下一步实机 smoke：

1. 让 bot 执行会触发多个工具的任务
2. 展开 Slack thread
3. 检查：
   - 是否出现 tool start / end
   - 参数是否能看懂
   - 错误是否会进 thread
   - 不同 follow-up 是否各自挂在自己的主消息下

---

## 9. 一句话结论

截至 `mom3.md` 记录点，`mypi` 中的 `mom` 已经不仅能“对话、跑工具、吃附件”，还已经具备了“把工具执行过程挂到 Slack thread 中供回看和调试”的基础产品可观测性。
