# Session 子系统实现计划

## 1. 文档定位

本目录专门拆解 `Coding-Agent` 层中的 `session` 子系统。

这里的 `session` 不是简单的聊天记录数组，而是一个**可持久化、可分支、可恢复、可压缩、可导航**的产品级状态系统。

如果目标是做出接近 `pi` 的 `coding-agent` 体验，那么 `session` 至少要覆盖：

- 本地持久化
- tree 结构与当前 leaf
- context rebuild
- `/tree` 导航与 branch summary
- `/fork` 与跨 session lineage
- manual / auto compaction
- model / thinking level 恢复
- session listing / resume / new
- Agent runtime 与 session state 的同步

本文档组的目标不是解释单个函数，而是把**要实现的完整需求面**拆清楚。

参考实现范围主要来自 `pi`：

- `pi-mono/packages/coding-agent/src/core/session-manager.ts`
- `pi-mono/packages/coding-agent/src/core/messages.ts`
- `pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `pi-mono/packages/coding-agent/src/core/compaction/compaction.ts`
- `pi-mono/packages/coding-agent/src/core/compaction/branch-summarization.ts`

---

## 2. 你要实现的 session 不只是 compaction

如果要把 `compaction` 实现到可用状态，实际上必须同时实现下面这些前置能力：

### 2.1 存储层

- append-only session file
- JSONL 解析与重建
- session header + typed entries
- 版本迁移
- list / resume / recent / fork file

### 2.2 树语义

- `id / parentId` 形成树
- 当前 `leaf`
- `getBranch()`
- `getTree()`
- `branch()` / `resetLeaf()`
- `branchWithSummary()`

### 2.3 上下文重建

- 从当前 leaf 到 root 提取 path
- 从 path 重建 `messages`
- 恢复 `model`
- 恢复 `thinkingLevel`
- 处理 `compaction`
- 处理 `branch_summary`
- 处理 `custom_message`

### 2.4 运行时桥接

- Agent 事件落盘
- 切换 session 时恢复 Agent state
- 新建 / resume / fork / tree navigate
- compact 后替换 Agent context

### 2.5 压缩子系统

- cut point
- keep recent suffix
- summary 生成
- split-turn summary
- multi-compaction rolling update
- threshold / overflow auto-compaction

换句话说：

```text
想实现 session compaction，必须先把 session 作为产品级状态系统实现出来。
```

---

## 3. 文档结构

### `storage.md`

说明 session 的目录结构、JSONL 文件格式、entry schema、list/resume/fork、迁移与持久化约束。

### `tree.md`

说明 session tree、leaf、branch、`/tree`、`branch_summary`、`/fork`、label、session name。

### `context.md`

说明 `buildSessionContext()` 的语义，哪些 entry 进入 LLM context，哪些只参与状态恢复。

### `compaction.md`

说明 manual / auto compaction、cut point、rolling summary、branch-local compaction、与 `branch_summary` 的交互。

### `runtime.md`

说明 session 和 Agent runtime 的桥接方式，何时 append entry，何时 rebuild context，何时恢复 model / thinking。

### `implementation.md`

按未来 `package/coding-agent` 的文件划分，拆出 session 子系统的逐模块实现顺序、依赖关系和里程碑。

### `testing.md`

覆盖 session 的单测、集成测试、真实 OpenAI smoke、`/tree` / `/fork` / `/compact` 交互验收计划。

---

## 4. 必须对齐的核心心智模型

### 4.1 session 不是 message[]

session 必须建模为：

```text
append-only event log + entry tree + current leaf + context rebuild rules
```

### 4.2 session file 不等于 LLM context

session 文件保存的是**完整历史**。

LLM 实际看到的是：

```text
buildSessionContext(currentLeaf)
```

也就是：

- 只看当前 branch
- 结合 compaction / branch summary 等规则重建
- 产出当前有效上下文

### 4.3 compaction 不是“删除历史”

compaction 的本质是：

- 在当前 branch 末尾追加一个 checkpoint entry
- 以后构建 context 时，用 `summary + kept suffix` 代替旧历史

所以 compaction 的本质是：

```text
改变 context rebuild 结果，而不是回写篡改旧历史
```

### 4.4 `/tree` 和 `/fork` 不是一回事

- `/tree`：在**同一个 session 文件**里切当前 leaf
- `/fork`：从某个历史点导出 / 派生一个**新的 session 文件**

如果目标是接近 `pi`，这两个都要实现。

---

## 5. 推荐实现顺序

### Phase 1：先做存储和树

先实现：

- session header
- typed entries
- append-only 存储
- `getBranch()`
- `getTree()`
- `branch()`
- `resetLeaf()`
- `create/open/continueRecent/list/forkFrom`

### Phase 2：做 context rebuild

实现：

- `buildSessionContext()`
- `model_change` / `thinking_level_change` 恢复
- `branch_summary` / `compaction` / `custom_message` 语义

### Phase 3：做 runtime 桥接

实现：

- Agent 事件落盘
- `newSession()`
- `switchSession()`
- `fork()`
- `navigateTree()`

### Phase 4：做 compaction

实现：

- manual compact
- auto compact
- rolling summary
- split turn
- threshold / overflow 触发

### Phase 5：补 session 附加能力

实现：

- label
- session title
- list all / session info
- stats / export（如需要）

---

## 6. Session 子系统验收总表

当下面这些能力都成立时，才算真正把 `session` 做到接近 `pi`：

- 能新建 session，并在本地持久化
- 能恢复最近 session 和指定 session
- 能从历史节点继续对话而不破坏旧分支
- 能在同一 session 文件里做 `/tree` 导航
- 能在 `/tree` 导航时选择是否生成 branch summary
- 能从历史节点做 `/fork`，生成独立 session 文件
- 能恢复 model / thinking level
- 能在 compact 后正确重建上下文
- 能多次 compact，并且只让最新 compact 生效
- 能在重启后恢复到 compact 后的有效上下文

---

## 7. 对 `mypi` 的建议目录划分

建议在 `mypi` 中把 session 相关实现拆成下面几个模块：

```text
src/session/
  session-types.ts
  session-manager.ts
  session-context.ts
  session-queries.ts
  session-runtime.ts
  session-compaction.ts
  branch-summarization.ts
```

如果你希望更接近 `pi` 的组织方式，也可以拆成：

```text
src/core/session/
  manager.ts
  context.ts
  messages.ts
  compaction.ts
  branch-summary.ts
  runtime.ts
```

如果严格按你当前 `mypi` 的 workspace 来落地，建议直接新增：

```text
package/coding-agent/
```

并让它依赖：

- `@mypi/ai`
- `@mypi/agent`
- `@mariozechner/pi-tui`

---

## 8. 本目录之外不展开的内容

本目录不详细展开：

- provider 协议
- Agent turn loop
- TUI 组件实现
- 工具本身的实现

这里只关注：

```text
session 如何存、如何分支、如何恢复、如何压缩、如何和运行时联动
```
