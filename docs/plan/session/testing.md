# Session 测试计划（以可像 `pi` 一样使用 `mypi` 为目标）

## 1. 测试目标

本计划的目标不是只验证若干纯函数，而是确保未来 `mypi` 的 session 子系统最终能支撑接近 `pi` 的实际使用体验。

也就是：

- 能正常对话并持久化
- 能退出重开并恢复
- 能 `/tree` 回到旧节点继续走新 branch
- 能 `/fork` 导出新 session file
- 能 `/compact` 后继续对话
- 能在多次 compact 后仍然恢复正确上下文
- 能与现有 `@mypi/ai`、`@mypi/agent`、`pi-tui` 联动

---

## 2. 测试范围分层

必须至少分成 4 层：

### 2.1 存储 / 纯函数单测

覆盖：

- JSONL parse/load
- session migration
- tree traversal
- context rebuild
- cut point / compaction prep
- branch summary range selection

### 2.2 runtime 集成测试

覆盖：

- Agent events -> session entries
- session restore -> agent state
- `newSession` / `switchSession` / `fork` / `navigateTree` / `compact`

### 2.3 CLI / TUI 行为测试

覆盖：

- `/resume`
- `/tree`
- `/fork`
- `/compact`
- compact / tree / fork 对 UI 状态的影响

### 2.4 真实冒烟测试

覆盖：

- 用真实 OpenAI official 走一遍完整 session 生命周期
- 验证“真的能像 pi 一样使用”

---

## 3. 测试目录建议

未来建议在 `package/coding-agent/test` 下至少建立：

```text
package/coding-agent/test/
  session-manager.test.ts
  session-context.test.ts
  session-tree.test.ts
  branch-summarization.test.ts
  session-compaction.test.ts
  session-runtime.test.ts
  session-resume.test.ts
  session-fork.test.ts
  session-tree-navigation.test.ts
  session-auto-compaction.test.ts
  session-smoke-openai.test.ts
```

如需交互测试，可再加：

```text
  interactive-session-smoke.ts
```

---

## 4. 单测矩阵

## 4.1 `session-manager.test.ts`

覆盖：

- 创建新 session
- 追加 typed entry
- reopen 后 entry 不丢失
- `id / parentId` 正确
- `getEntry/getEntries/getHeader/getLeafId` 正确
- `list/continueRecent/forkFrom` 正确
- 空文件 / 坏行 / 非法 header 的容错
- migration 正确

通过标准：

- session file 作为 append-only event log 可稳定工作

## 4.2 `session-tree.test.ts`

覆盖：

- `getBranch()` root-first 顺序正确
- `getTree()` child 排序正确
- `branch()` 只改 leaf 不改旧 entry
- `resetLeaf()` 语义正确
- `branchWithSummary()` 正确追加 `branch_summary`
- `createBranchedSession()` 导出的 session file 只包含目标 path

通过标准：

- 同文件 branch 和跨文件 fork 都成立

## 4.3 `session-context.test.ts`

覆盖：

- 无 compaction 时全量 context
- 单次 compaction
- 多次 compaction 只认 latest
- branch_summary 进入 context
- custom_message 进入 context
- `model_change` / `thinking_level_change` 恢复
- 不同 leaf 下 context 不同
- sibling branch 不互相污染

通过标准：

- `buildSessionContext()` 成为 session 语义唯一可信实现

## 4.4 `branch-summarization.test.ts`

覆盖：

- `collectEntriesForBranchSummary()` 范围正确
- common ancestor 计算正确
- 只总结被放弃 branch，不总结目标 branch
- token budget 控制生效
- nested branch_summary details 可累计

通过标准：

- `/tree` summary 生成范围稳定

## 4.5 `session-compaction.test.ts`

覆盖：

- `findValidCutPoints()`
- `findTurnStartIndex()`
- `findCutPoint()`
- split-turn compact
- single compact
- multi compact rolling update
- latest only rebuild
- branch_summary 被 compact 吸收
- compact 太近时拒绝 / 合法运行

通过标准：

- compaction 核心算法稳定

---

## 5. Runtime 集成测试矩阵

## 5.1 `session-runtime.test.ts`

覆盖：

- `message_end` 时 user/assistant/toolResult 落盘
- `setModel()` 写入 `model_change`
- `setThinkingLevel()` 写入 `thinking_level_change`
- `compact()` 成功后 append `compaction`
- `navigateTree(summary=true)` append `branch_summary`

通过标准：

- session 与 Agent runtime 同步可靠

## 5.2 `session-resume.test.ts`

覆盖：

- resume 后 messages 恢复正确
- resume 后 model 恢复正确
- resume 后 thinking 恢复正确
- compact 后退出重开仍恢复 compact 后视图
- branch_summary 路径退出重开后仍恢复正确

通过标准：

- resume 是真正产品可用的，不只是“把文件读出来”

## 5.3 `session-fork.test.ts`

覆盖：

- 从 user message fork
- 从非 root path fork
- 新 session file 有 `parentSession`
- 旧 session 完全不变
- 新 session 可以继续 compact / tree / resume

通过标准：

- `/fork` 成为稳定产品行为

## 5.4 `session-tree-navigation.test.ts`

覆盖：

- 从当前 leaf 导航到任意旧节点
- 不 summary 导航
- summary 导航
- 导航后 agent.replaceMessages 生效
- 导航到 user message 时 editor text 回填逻辑正确

通过标准：

- `/tree` 成为真实可用能力

## 5.5 `session-auto-compaction.test.ts`

覆盖：

- threshold auto compact
- overflow compact
- overflow compact 后自动 continue
- auto compact 不破坏 queued messages
- auto compact 后 context 使用 latest summary

通过标准：

- 长会话下 session 仍可持续使用

---

## 6. 交互与冒烟测试计划

## 6.1 非交互 smoke（优先自动化）

建议新增脚本，例如：

```text
package/coding-agent/scripts/session-smoke-openai.mjs
```

测试流程建议：

1. 创建临时 session 目录
2. 使用真实 OpenAI official model
3. 发送几轮 prompt，确保 session file 落盘
4. 切换 model / thinking
5. 手动 compact
6. 重启 runtime 并 resume
7. 断言恢复后的 context / model / thinking 正确

目标：

- 确认 `@mypi/ai + @mypi/agent + session runtime` 联动成立

## 6.2 `/tree` + `/fork` smoke

建议做一个端到端脚本：

1. 走出一条分支：`a b c d e`
2. 回到 `c` 再走：`f g h i`
3. 在 `i` 上 compact
4. `/tree` 回到 `e`
5. 再从 `e` 继续
6. 从某个 user 节点执行 `/fork`
7. 重启并分别 resume 原 session 与 fork session

需要验证：

- 原 session 树不乱
- compact 只影响当前 branch
- fork 生成新 session file
- resume 能恢复各自正确上下文

## 6.3 TUI smoke

如果未来 `mypi` 有自己的 `interactive-app`，建议至少有一组手工或半自动验证：

- 启动后能看到当前 session 信息
- `/resume` 能列出 session
- `/tree` 能切 branch
- `/compact` 后 UI 中上下文持续可用
- `/fork` 后切入新 session

---

## 7. “像 pi 一样能用”的验收场景

下面这些场景全部通过，才算 session 子系统达到你当前目标。

### 场景 A：正常多轮会话

- 新建 session
- 连续多轮对话
- 退出后 resume
- 恢复到正确状态

### 场景 B：分支恢复

- 在旧 user 节点继续写新分支
- 原 branch 保持不变
- `/tree` 能回到两个 branch

### 场景 C：branch summary

- 从一条 branch 回到另一条 branch
- 可选 summary
- summary 后模型仍理解先前尝试过的内容

### 场景 D：手动 compact

- 会话足够长后执行 `/compact`
- compact 后还能继续对话
- 重启后仍恢复 compact 后视图

### 场景 E：多次 compact

- 第一次 compact 生成 `C1`
- 继续对话后再 compact 生成 `C2`
- 当前 context 只认 latest compaction
- reload 后仍只认 latest compaction

### 场景 F：fork

- 从历史节点创建独立 session file
- 新旧会话都能分别继续使用

### 场景 G：模型与 thinking 恢复

- 切换模型
- 切换 thinking
- 重启 / resume 后仍恢复

---

## 8. 测试执行建议

在 `mypi` 当前工作区下，建议：

### 8.1 保留现有底层测试

继续运行：

- `npm run test --workspace @mypi/ai`
- `npm run test --workspace @mypi/agent`
- `npm run test --workspace @mariozechner/pi-tui`

它们验证底层层级没有回归。

### 8.2 新增 coding-agent/session 测试

未来新增 `package/coding-agent` 后，建议：

- `npm run test --workspace @mypi/coding-agent`

并让其覆盖：

- session 单测
- session runtime 集成测试
- smoke 测试

### 8.3 回归顺序

每次改 session 相关逻辑，建议回归顺序：

1. session 单测
2. session runtime 集成测试
3. session smoke openai
4. 全仓 typecheck

---

## 9. 最低发布前门槛

在你准备真正开始日常使用 `mypi` 之前，至少应达到：

- session storage / tree / context 单测全部通过
- runtime 集成测试全部通过
- `/tree` / `/fork` / `/compact` 关键场景 smoke 全部通过
- 真实 OpenAI official smoke 至少连续通过 3 次
- 重启恢复场景无随机失败

只有这样，才能 reasonably 认为：

```text
mypi 已经可以像 pi 一样日常使用 session tree、resume、fork、compact
```
