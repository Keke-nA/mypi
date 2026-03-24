# 01 Session Foundation

本阶段落地文件：

- `package/coding-agent/src/core/session-types.ts`
- `package/coding-agent/src/core/messages.ts`
- `package/coding-agent/src/core/session-manager.ts`
- `package/coding-agent/src/core/session-context.ts`
- `package/coding-agent/src/core/branch-summarization.ts`
- `package/coding-agent/src/core/session-compaction.ts`
- `package/coding-agent/src/core/session-runtime.ts`
- `package/coding-agent/src/core/agent-session.ts`

## 已实现内容

### 1. Session ABI

统一定义了：

- `SessionHeader`
- `SessionEntryBase`
- `message / model_change / thinking_level_change / compaction / branch_summary / custom / custom_message / label / session_info`
- `SessionContext`

### 2. Storage

实现了 append-only JSONL session file：

- 创建 session
- 打开 session
- 列出当前工作区 session
- 列出全部 session
- fork 新 session file

### 3. Tree 语义

实现了：

- `leafId`
- `getBranch()`
- `getChildren()`
- `getTree()`
- `branch()`
- `resetLeaf()`
- `branchWithSummary()`
- `createBranchedSession()`

### 4. Context rebuild

实现了：

- 从当前 leaf 回溯 path
- rebuild 当前有效 `messages`
- 恢复 `model`
- 恢复 `thinkingLevel`
- latest-only compaction rebuild
- `branch_summary` / `custom_message` 注入上下文

### 5. Runtime bridge

实现了：

- `Agent` 的 `message_end` 自动落盘
- `newSession()`
- `switchSession()`
- `fork()`
- `navigateTree()`
- `compact()`
- session -> agent restore

## 当前边界

已实现的是 session 主干，不是最终 UI 产品。

因此：

- session 语义已经成立
- CLI/TUI 只是这套 runtime 的不同前端壳
