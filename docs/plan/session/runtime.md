# Session Runtime 桥接与产品行为需求

## 1. 目标

session 存储层本身不会自动和 Agent 协同。

如果目标是做出接近 `pi` 的 coding-agent，需要再加一层 runtime 桥接，负责：

- 把 Agent 事件写入 session
- 切换 session 时恢复 Agent state
- 处理 `/new`、`/resume`、`/tree`、`/fork`、`/compact`
- 保持 session 与当前 product state 一致

参考：

- `pi-mono/packages/coding-agent/src/core/agent-session.ts`

---

## 2. 核心原则

### 2.1 session 是 source of truth

Agent runtime 的 messages 只是当前内存视图。

真正可持久恢复的真相应该是 session。

因此要求：

- 重要产品状态变化必须落成 entry
- 恢复时必须由 session 重建 runtime，而不是反过来

### 2.2 runtime 不应绕过 session 直接改上下文

如果发生：

- 切模型
- 改 thinking
- compact
- tree navigate
- fork

都不应只改内存状态而不落盘。

---

## 3. 必须落盘的时机

### 3.1 message end

当 Agent 一条消息生命周期结束时，必须决定是否写入 session：

- `user`
- `assistant`
- `toolResult`
- `custom`（如果映射成 `custom_message`）

### 3.2 model change

当用户切模型时，必须 append `model_change`。

### 3.3 thinking level change

当 thinking 变化时，必须 append `thinking_level_change`。

### 3.4 compact

compact 成功后，必须 append `compaction`。

### 3.5 branch summary

`/tree` 选择 summary 时，必须 append `branch_summary`。

### 3.6 label / session title

如果支持 label 和 session title，也必须通过 entry 落盘。

---

## 4. `newSession()` 需求

要求：

1. abort 当前运行
2. reset Agent state
3. 新建 session file
4. 重置 pending steering / follow-up / queued internal messages
5. 写入当前 thinking level
6. 如有初始化 setup，再同步到 Agent messages

如果要对齐 `pi`，`newSession()` 不只是清空 messages，还必须切换到新的 session ID / session file。

---

## 5. `switchSession()` / `/resume` 需求

要求：

1. abort 当前运行
2. 清空 runtime 中和旧 session 绑定的 pending 状态
3. 切到新的 session file
4. 调用 `buildSessionContext()`
5. `agent.replaceMessages(...)`
6. 恢复 model
7. 恢复 thinking level
8. 恢复 session id / ui state

这里必须注意：

- 不能只恢复 messages
- 必须恢复 model / thinking
- 如果 session 中没有显式 thinking entry，需要定义默认回退规则

---

## 6. `fork()` 需求

要求：

- 从指定历史 entry 创建独立 session file
- 如果选中的是 user message，允许把文本回填到 editor
- 新 session 切换完成后，需要 rebuild context 并替换 Agent messages

这意味着 runtime 层必须把：

- SessionManager
- Agent
- UI

三者同步切换。

---

## 7. `navigateTree()` 需求

要求：

- 允许导航到任意历史节点
- 可选 summary
- 切换 leaf 后 rebuild context
- `agent.replaceMessages(...)`
- 如果目标是 user message，允许把该 user 文本回填到 editor

这一步是 `/tree` 的产品核心。

---

## 8. `compact()` 需求

runtime 层要做的不只是调 summarizer，还包括：

- 先 abort 当前运行
- compact 成功后 rebuild context
- `agent.replaceMessages(...)`
- 保证后续继续对话时主模型看到的是 compact 后 context

如果是 auto-compaction，还需要区分：

- threshold: compact 后等待后续继续
- overflow: compact 后自动 retry / continue 一次

---

## 9. Session 相关命令需求

如果目标接近 `pi`，建议 session 相关产品命令至少包括：

- `/new`
- `/resume`
- `/tree`
- `/fork`
- `/compact`
- `/session`（查看当前 session 信息）
- `/name-session` 或等价命令（可选）
- label 操作命令（可选）

其中核心必须项应是：

- `/new`
- `/resume`
- `/tree`
- `/fork`
- `/compact`

---

## 10. 与 UI 的接口需求

TUI 不应自己定义 session 语义。

建议 runtime 暴露：

- 当前 session file
- 当前 session id
- 当前 session title
- 当前 leaf id
- 当前 tree 数据
- 当前是否 compacting
- 当前是否 streaming

以及：

- `newSession()`
- `switchSession()`
- `fork()`
- `navigateTree()`
- `compact()`
- `setSessionName()`
- label 操作

---

## 11. 额外能力

如果希望更接近 `pi`，还可以规划：

### session stats

统计：

- user / assistant / toolResult 数量
- tool calls 数量
- input / output / cache tokens
- cost

### export

例如：

- 导出 HTML
- 导出 gist / share link

这些不是 compaction 的前置条件，但属于 session 相关产品能力。

---

## 12. 测试与验收

必须覆盖：

- `newSession()` 后 runtime 与 session file 同步更新
- `switchSession()` 后 messages / model / thinking 恢复正确
- `fork()` 后旧 session 不变，新 session 正常继续
- `navigateTree()` 后 Agent context 立即切换
- `compact()` 后 Agent context 被替换为 compact 后视图
- reload 后与 compact / tree / fork 组合行为正确

---

## 13. 对 `mypi` 的建议模块划分

建议至少拆出：

```text
src/session/session-runtime.ts
```

由它承担：

- Agent 事件 -> SessionEntry
- Session file -> Agent restore
- Product commands -> Session operations

不要把这些规则直接散落在：

- CLI 命令处理
- TUI 组件
- Agent runtime 本体

因为这是产品层的运行时桥接逻辑，应当独立出来。
