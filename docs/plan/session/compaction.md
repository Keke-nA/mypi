# Session Compaction 需求

## 1. 目标

compaction 的目标不是删除历史，而是：

```text
在不破坏 session tree 的前提下，压缩当前 branch 的较旧上下文，保留较新的 raw suffix
```

它必须同时满足：

- branch-local
- append-only
- 可多次滚动 compact
- reload 后仍然成立
- 不破坏 `/tree` 和 `/fork`

参考 `pi`：

- `pi-mono/packages/coding-agent/src/core/compaction/compaction.ts`
- `pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `pi-mono/packages/coding-agent/src/core/session-manager.ts`

---

## 2. compaction 的本质

compaction 不是：

- 删除旧消息
- 覆盖旧 branch
- 修改历史 entry

compaction 的本质是：

1. 对当前 branch 的旧上下文生成 summary
2. 追加一个 `compaction` entry
3. 以后 `buildSessionContext()` 时，用：

```text
compaction summary + kept suffix + post-compaction messages
```

代替旧历史

---

## 3. 为什么 compaction 只能是 branch-local

如果当前树是：

```text
a -> b -> c -> d -> e
          \
           f -> g -> h -> i
```

当你在 `i` 上 compact，实际只应作用于：

```text
a -> b -> c -> f -> g -> h -> i
```

绝不能影响：

```text
a -> b -> c -> d -> e
```

因此 compact 必须以：

```text
当前 branch pathEntries
```

为输入，而不是全文件 entries。

---

## 4. compaction entry 需求

`compaction` entry 至少必须包含：

```ts
interface CompactionEntry {
  type: "compaction";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}
```

### 字段语义

- `summary`
  被折叠历史的 checkpoint summary
- `firstKeptEntryId`
  compaction 前 branch 上，从哪个 entry 开始保留 raw suffix
- `tokensBefore`
  compaction 前上下文 token 估计，用于统计和 UI
- `details`
  可选扩展数据，例如 read/modified files

---

## 5. 手动 compact 流程需求

手动 `/compact` 至少要做：

1. 停止当前 agent streaming
2. 获取当前 branch `pathEntries`
3. 运行 `prepareCompaction(pathEntries, settings)`
4. 如果无法 compact，返回明确错误
5. 生成 summary
6. 追加 `compaction` entry
7. 调用 `buildSessionContext()`
8. 用新上下文替换 Agent messages

### 失败场景

至少要处理：

- 没有 model
- 没有 apiKey
- 已经刚 compact 过
- session 太小，没必要 compact
- summarizer 失败
- 用户取消

---

## 6. 自动 compact 流程需求

如果对齐 `pi`，建议实现两类 auto-compaction：

### 6.1 threshold auto-compaction

当 context 接近模型窗口上限时触发。

判断语义建议：

```text
contextTokens > contextWindow - reserveTokens
```

其中：

- `reserveTokens` 预留给 prompt 和模型输出
- `keepRecentTokens` 决定 suffix 大致保留多少原始 token

### 6.2 overflow recovery compact

当模型已经返回 context overflow error 时触发。

要求：

- 先把报错的 assistant message 从当前 Agent context 中移除
- compact
- 然后自动继续一次

如果是 `pi` 对齐级行为，overflow compact 和 threshold compact 的区别不能省略。

---

## 7. cut point 需求

compaction 不能简单粗暴“砍前 80%”。

必须实现类似 cut point 的逻辑。

### 7.1 目标

- 尽量保留最近 `keepRecentTokens`
- cut 在合法边界上
- 不在 `toolResult` 中间切
- 必要时支持 split turn

### 7.2 合法 cut point

建议至少允许：

- user message
- assistant message
- custom message
- branch_summary
- bashExecution

不应直接切在：

- toolResult

### 7.3 split turn

如果 cut 点落在 turn 中间，例如 assistant message 上：

- 必须找到该 turn 的 user 起点
- 把 turn 前缀做成额外 summary
- 保证 kept suffix 仍然可理解

如果不实现 split-turn，compact 在真实 session 里会频繁出现上下文断裂。

---

## 8. 多次 compaction 需求

这是最容易理解错、但必须实现正确的部分。

### 8.1 第二次 compact 不是全量重做

第二次 compact 时：

- 先找到当前 branch 上**最近一次 compaction**
- 只处理这个 compact 之后的新增历史
- 上一次 summary 作为 `previousSummary`
- 再生成新的 summary

### 8.2 `previousSummary` 不是数组

要求：

- `previousSummary` 是**单个字符串**
- 它等于“当前 branch 上最近一次 compact 的 summary”
- 不是 `[S1, S2, S3]`

### 8.3 rolling update 语义

设：

```text
C1.summary = S1
C2.summary = S2
C3.summary = S3
```

则语义是：

```text
S2 = update(S1, M2)
S3 = update(S2, M3)
```

也就是说：

- `S2` 已经吸收了 `S1`
- `S3` 已经吸收了 `S2`
- 下一次 compact 只需要最新 summary

### 8.4 build context 只认 latest compaction

多次 compact 后，context rebuild 必须只认最新一个 compact。

要求：

- older compaction 仍保留在文件里
- 但当前 context 只使用 latest checkpoint

---

## 9. compaction 与 `branch_summary` 的交互

`branch_summary` 在 compaction 中必须被视为 message-like 内容。

这意味着：

- 它可能仍作为 raw suffix 被保留
- 也可能被折叠进新的 compaction summary

这是正确行为，不是异常。

因为 branch_summary 本身就是当前 branch 上的正式上下文内容。

---

## 10. compaction 后 reload 的行为需求

compact 完后退出程序，再 resume，要求：

- session file 中旧 history 仍在
- latest leaf 应落在 latest compaction 节点或其后续节点
- `buildSessionContext()` 仍能得到 compact 后的有效上下文

也就是说：

```text
compact 的效果必须是可持久恢复的
```

不能只在内存里生效。

---

## 11. “离得很近的 compact” 要求

必须处理下面几种场景：

### 11.1 刚 compact 完又立刻手动 compact

如果当前 branch 最后一个 entry 已经是 compaction：

- 应直接拒绝
- 返回类似“Already compacted”的错误

### 11.2 compact 后只有少量新消息

要求：

- 手动 compact 仍可执行
- 自动 compact 通常不会触发，除非达到阈值

### 11.3 多次很密集 compact

要求：

- 行为仍然正确
- 即 rolling summary 继续成立
- 即使收益不高，也不应破坏上下文语义

---

## 12. 参数需求

建议至少支持：

### `keepRecentTokens`

决定保留多少 recent raw suffix。

### `reserveTokens`

为 summary prompt 和模型输出预留空间。

### `enabled`

控制 auto-compaction 是否启用。

如对齐 `pi`，建议默认值：

- `keepRecentTokens = 20000`
- `reserveTokens = 16384`

---

## 13. 测试矩阵

必须覆盖：

- 单次 compact
- 多次 compact，只认 latest
- split-turn compact
- branch-local compact
- compact 后 reload
- branch_summary 被 compact 吸收
- overflow compact 自动重试
- threshold compact 不破坏后续队列消息

---

## 14. 验收标准

- compact 不改写旧历史
- compact 只作用于当前 branch
- compact 后 context rebuild 正确
- 多次 compact 形成 rolling summary，而不是 summary 数组
- reload 后 compact 结果仍成立
- `branch_summary` 与 compaction 的交互语义稳定
