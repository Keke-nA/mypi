# Session Context Rebuild 需求

## 1. 目标

session 的最终目的不是“把历史写盘”，而是：

```text
在任意时刻，从 session tree 重建出当前应该发给 LLM 的上下文
```

因此必须实现一个类似 `buildSessionContext()` 的核心函数。

它至少返回：

```ts
interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}
```

---

## 2. 为什么必须单独实现 context rebuild

因为 session file 保存的是：

- 完整历史
- 分支结构
- model / thinking 变化
- compaction checkpoint
- branch summary
- 自定义消息

而 LLM 需要的只是：

- 当前 branch 的有效消息序列
- 当前 branch 上生效的 model / thinking 状态

所以必须有一层：

```text
session entries -> SessionContext
```

---

## 3. 输入与输出需求

### 输入

- 全量 session entries
- 指定 leafId，或默认当前 leaf
- 可选 byId index

### 输出

- `messages`
- `thinkingLevel`
- `model`

### 约束

- 输出不应依赖 UI 状态
- 输出应可直接喂给 Agent runtime
- 输出必须对同一组输入保持确定性

---

## 4. 重建步骤需求

### 4.1 先确定 leaf

规则建议：

- 如果显式给了 leafId，就用它
- 如果 leafId 为 `null`，表示回到第一条 entry 之前
- 如果没给 leafId，则用当前 leaf
- 如果指定 leaf 找不到，可以回退到最后一个 entry

### 4.2 从 leaf 回溯到 root

必须沿 `parentId` 回溯，而不是简单扫描文件。

输出应是 root-first path。

### 4.3 从 path 中恢复非消息状态

至少要恢复：

- 最新的 thinkingLevel
- 最新的 model

如果 path 中没有显式 model_change，可以退回到最后一个 assistant message 上记录的 provider/model 元信息。

### 4.4 组装消息

path 中不是所有 entry 都会变成 message。

必须按规则把 path 中的 entry 转成 messages。

---

## 5. 各类 entry 对 context 的影响

### 5.1 `message`

- 直接进入 messages

### 5.2 `custom_message`

- 转成一条 custom AgentMessage
- 进入 messages

### 5.3 `branch_summary`

- 转成一条 branch summary message
- 进入 messages

### 5.4 `compaction`

- 不直接按 entry 原样进入 messages
- 它会触发“summary + kept suffix”的特殊 rebuild 逻辑

### 5.5 `thinking_level_change`

- 不进入 messages
- 只更新 `thinkingLevel`

### 5.6 `model_change`

- 不进入 messages
- 只更新 `model`

### 5.7 `custom`

- 不进入 messages

### 5.8 `label`

- 不进入 messages

### 5.9 `session_info`

- 不进入 messages

---

## 6. compaction 下的 rebuild 规则

这是整个 session 系统中最关键的逻辑之一。

### 6.1 无 compaction

如果 path 中没有 compaction：

- 输出 path 上所有 message-like 内容

### 6.2 有 compaction

如果 path 中有 compaction：

- 只取**最新**那一个 compaction
- 输出顺序必须是：
  1. `compactionSummary`
  2. 从 `firstKeptEntryId` 开始的 kept messages
  3. compaction 之后的新消息

### 6.3 为什么只认最新 compaction

因为 compaction 是 rolling checkpoint。

要求：

- 较早的 compaction 已经被新 compaction 吸收
- rebuild 时只需要 latest checkpoint

---

## 7. branch summary 下的 rebuild 规则

如果当前 path 上包含 `branch_summary`：

- 它应像一条 user-style summary message 一样进入上下文
- 后续 compaction 可以继续吸收它

这意味着：

- `branch_summary` 是当前 branch 上的正式上下文组成部分
- 不是纯 UI 注释

---

## 8. custom_message 的要求

如果未来支持扩展或产品内部消息注入，必须区分：

- `custom`
  只做持久化，不进入上下文
- `custom_message`
  进入上下文

如果不区分这两个概念，后续会导致：

- 扩展状态污染模型上下文
- 或扩展想注入上下文却找不到正规 entry 类型

---

## 9. reload / resume 时的上下文恢复

当执行 `/resume` 或打开已有 session 时，要求：

1. 读取文件并建立 index
2. 选定当前 leaf
3. 调用 `buildSessionContext()`
4. 用结果恢复 Agent messages
5. 恢复 model
6. 恢复 thinking level

也就是说：

```text
session file 不是直接拿来继续跑
而是必须先 rebuild 成 runtime context
```

---

## 10. 验收场景

### 场景 A：无分支、无 compaction

要求：

- 直接重建全消息序列

### 场景 B：有 branch

要求：

- 指向不同 leaf 时，重建结果不同
- sibling branch 不互相污染

### 场景 C：单次 compaction

要求：

- 输出 latest compaction summary
- kept suffix 正确
- compaction 前被折叠的消息不再 raw 进入上下文

### 场景 D：多次 compaction

要求：

- 只认最新 compaction
- older compaction 不重复进入上下文

### 场景 E：branch_summary + compaction

要求：

- branch_summary 可以作为 raw message 存在于上下文中
- 也可以在后续 compaction 中被吸收进 summary

---

## 11. 对 `mypi` 的实现建议

建议把这一层抽成独立模块，例如：

```text
src/session/session-context.ts
```

不建议把这些规则散落到：

- Agent runtime
- TUI 层
- `/tree` 命令实现

因为 context rebuild 是 session 的核心语义，不应由 UI 或命令临时拼装。
