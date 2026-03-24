# Session 实现计划（对齐 `mypi` 现有分层）

## 1. 当前前提

你现在已经有：

- `package/ai`：`@mypi/ai`
- `package/agent`：`@mypi/agent`
- `package/pi-tui`：直接复用 `pi-tui`

所以缺失的核心是：

```text
package/coding-agent
```

并且 `session` 子系统会是这个未来 `package/coding-agent` 里最厚、最关键的一块。

如果目标是“像 pi 一样正常使用 mypi”，那么 `session` 不应被视为附属能力，而应被视为 coding-agent runtime 的核心基础设施。

---

## 2. 建议目录与模块切分

建议未来在 `mypi` 中新增：

```text
package/coding-agent/
  src/
    core/
      session-types.ts
      session-manager.ts
      session-context.ts
      session-runtime.ts
      session-compaction.ts
      branch-summarization.ts
      messages.ts
      settings-manager.ts
      model-manager.ts
      agent-session.ts
    cli/
      main.ts
      commands.ts
    ui/
      interactive-app.ts
      session-tree-view.ts
      session-selector.ts
      model-selector.ts
  test/
    session-manager.test.ts
    session-context.test.ts
    session-tree.test.ts
    session-compaction.test.ts
    session-runtime.test.ts
    session-integration.test.ts
```

### 为什么这样拆

- `session-types.ts`
  统一 ABI，避免类型散落
- `session-manager.ts`
  专注 append-only 存储和树查询
- `session-context.ts`
  专注 `buildSessionContext()`
- `session-compaction.ts`
  专注 compact 算法与 summary 滚动
- `branch-summarization.ts`
  专注 `/tree` summary 行为
- `session-runtime.ts`
  专注 Session <-> Agent 的桥接
- `agent-session.ts`
  作为产品层 facade，供 CLI / TUI 使用

---

## 3. 总体实施顺序

必须按下面顺序做，而不是先做 UI：

### Phase 1：Session ABI 与存储骨架

目标：

- 先把 session file 作为稳定协议定义清楚
- 不依赖 TUI
- 不依赖 compaction

要实现：

- `SessionHeader`
- `SessionEntryBase`
- 所有 typed entries
- JSONL parse / load / append / rewrite
- `create/open/continueRecent/inMemory/list/listAll/forkFrom`
- `getEntry/getEntries/getHeader`

对应文件：

- `core/session-types.ts`
- `core/session-manager.ts`

完成标准：

- 能创建 session file
- 能 append typed entry
- 能重新打开并恢复所有 entry
- 能 list / open / fork file

### Phase 2：Tree 语义

目标：

- 让 session 变成树，而不是线性日志

要实现：

- `leafId`
- `getBranch()`
- `getTree()`
- `getChildren()`
- `branch()`
- `resetLeaf()`
- `branchWithSummary()`
- `createBranchedSession()`
- label / session title 基础操作

对应文件：

- `core/session-manager.ts`

完成标准：

- 同一 session file 能形成多 branch
- 切 branch 不改旧历史
- fork 能导出新 session file

### Phase 3：Context Rebuild

目标：

- 从任意 leaf 正确重建当前 branch 的有效上下文

要实现：

- `buildSessionContext(entries, leafId, byId?)`
- `message` / `custom_message` / `branch_summary` 进入 messages
- `compaction` 的 latest-only rebuild 规则
- `model_change` / `thinking_level_change` 恢复
- `custom` / `label` / `session_info` 不进入 messages

对应文件：

- `core/session-context.ts`
- `core/messages.ts`

完成标准：

- 无分支、分支、单次 compact、多次 compact、branch summary 全都能重建正确

### Phase 4：Runtime 桥接

目标：

- 把现有 `@mypi/agent` 跟 session 存储接起来

要实现：

- `newSession()`
- `switchSession()`
- `fork()`
- `navigateTree()`
- `setSessionName()`
- label 操作
- Agent event -> session entry
- session -> `agent.replaceMessages()`
- model / thinking 恢复

对应文件：

- `core/session-runtime.ts`
- `core/agent-session.ts`

完成标准：

- `/new`、`/resume`、`/tree`、`/fork` 能改变当前 runtime state
- 退出重启后能恢复正确 context / model / thinking

### Phase 5：Compaction

目标：

- 完成 `pi` 级 session compaction 语义

要实现：

- `prepareCompaction()`
- `findCutPoint()`
- split-turn
- `compact()`
- rolling summary
- branch-local compaction
- auto compact (threshold / overflow)
- compact 后 rebuild + replace messages

对应文件：

- `core/session-compaction.ts`
- `core/messages.ts`
- `core/agent-session.ts`

完成标准：

- 单次 compact 成立
- 多次 compact 只认 latest
- reload 后 compact 结果仍成立
- overflow compact 可以恢复一次继续运行

### Phase 6：CLI / TUI 接入

目标：

- 把 session 子系统变成用户能实际操作的产品能力

要实现：

- `/new`
- `/resume`
- `/tree`
- `/fork`
- `/compact`
- `/session`
- session selector
- tree view
- compacting / streaming 状态展示

对应文件：

- `cli/main.ts`
- `cli/commands.ts`
- `ui/interactive-app.ts`
- `ui/session-tree-view.ts`
- `ui/session-selector.ts`

完成标准：

- 用户能像使用 `pi` 一样在 session 间切换、分支、压缩、恢复

---

## 4. 逐文件实施清单

## 4.1 `core/session-types.ts`

必须定义：

- `SessionHeader`
- `SessionEntryBase`
- `SessionMessageEntry`
- `ThinkingLevelChangeEntry`
- `ModelChangeEntry`
- `CompactionEntry`
- `BranchSummaryEntry`
- `CustomEntry`
- `CustomMessageEntry`
- `LabelEntry`
- `SessionInfoEntry`
- `SessionEntry`
- `FileEntry`
- `SessionTreeNode`
- `SessionContext`
- `SessionInfo`

验收标准：

- 编译期能约束 storage / context / runtime / tests 使用同一套 ABI

## 4.2 `core/session-manager.ts`

必须实现：

- `newSession()`
- `setSessionFile()`
- `getSessionDir()`
- `getSessionId()`
- `getSessionFile()`
- `appendMessage()`
- `appendThinkingLevelChange()`
- `appendModelChange()`
- `appendCompaction()`
- `appendCustomEntry()`
- `appendCustomMessageEntry()`
- `appendLabelChange()`
- `appendSessionInfo()`
- `getLeafId()`
- `getLeafEntry()`
- `getEntry()`
- `getChildren()`
- `getLabel()`
- `getBranch()`
- `getTree()`
- `branch()`
- `resetLeaf()`
- `branchWithSummary()`
- `createBranchedSession()`
- `create/open/continueRecent/inMemory/forkFrom/list/listAll`

完成后效果：

- session file、tree、fork file 语义全部成立

## 4.3 `core/messages.ts`

必须实现：

- `createCompactionSummaryMessage()`
- `createBranchSummaryMessage()`
- `createCustomMessage()`
- `bashExecutionToText()`（如果保留这类产品消息）
- `convertToLlm(messages)`

要求：

- `compactionSummary` 和 `branchSummary` 能稳定映射进主模型上下文

## 4.4 `core/session-context.ts`

必须实现：

- `buildSessionContext()`
- latest compaction only
- summary + kept suffix rebuild
- model / thinking restore

这是 session 子系统的核心之一。

## 4.5 `core/branch-summarization.ts`

必须实现：

- `collectEntriesForBranchSummary()`
- `prepareBranchEntries()`
- `generateBranchSummary()`

要求：

- `/tree` 返回旧节点时，summary 的范围只覆盖被放弃 branch
- 可以保留文件读写轨迹等 details

## 4.6 `core/session-compaction.ts`

必须实现：

- `estimateTokens()`
- `findValidCutPoints()`
- `findTurnStartIndex()`
- `findCutPoint()`
- `prepareCompaction()`
- `compact()`
- `shouldCompact()`

要求：

- 支持 split-turn
- 支持 rolling summary
- 支持 branch_summary 与 compaction 共存

## 4.7 `core/session-runtime.ts`

必须实现：

- Agent event 持久化
- Session -> Agent restore
- `newSession()`
- `switchSession()`
- `fork()`
- `navigateTree()`
- `compact()`
- model / thinking / title / label runtime 操作

要求：

- 这是 session 与 `@mypi/agent` 的唯一正式桥接层

## 4.8 `core/agent-session.ts`

如果你想接近 `pi`，建议再做一个产品 facade：

- 持有 `agent`
- 持有 `sessionManager`
- 对外暴露 `/tree`、`/fork`、`/compact` 等产品操作
- 向 TUI 提供统一只读状态和事件

---

## 5. 依赖关系

未来 `package/coding-agent` 的 session 子系统，建议依赖关系如下：

```text
@mypi/ai
  -> 提供模型、messages、summary LLM 调用

@mypi/agent
  -> 提供 Agent runtime、事件流、replaceMessages、abort、continue

@mariozechner/pi-tui
  -> 提供 interactive UI 组件和输入框架
```

注意：

- `session` 语义不应下沉到 `@mypi/agent`
- `session` 语义也不应由 `pi-tui` 承担
- `session` 必须位于 `coding-agent` 这一层

---

## 6. 里程碑定义

### M1：Storage + Tree Ready

代表：

- 能新建 / 打开 / 列表 / fork file
- 能维护 tree 和 leaf

### M2：Context Ready

代表：

- 能从任意 leaf 重建正确的 `messages/model/thinking`

### M3：Runtime Ready

代表：

- `/new` `/resume` `/tree` `/fork` 可以跑通

### M4：Compaction Ready

代表：

- manual / auto compaction 完整成立
- reload 后也正确

### M5：pi-like Usability Ready

代表：

- 用户能通过 TUI 实际使用 session tree + compact + resume

---

## 7. 非目标

这份实现计划不要求你第一版就做：

- extensions / skills / themes
- html export
- gist share
- rpc / print mode
- 包管理与插件系统

但要求你把 session 主干做完整，因为 compact / tree / fork / resume 是一体的。
