# Session Tree、`/tree`、`/fork` 与 Branch Summary 需求

## 1. 目标

session tree 的目标是让单个 session file 支持：

- 从历史节点回到旧位置继续对话
- 保留旧路径不被覆盖
- 可选生成 branch summary
- 从历史路径导出新 session file

如果对齐 `pi`，tree 机制至少包括：

- `getBranch()`
- `getTree()`
- `branch()`
- `resetLeaf()`
- `branchWithSummary()`
- `createBranchedSession()`
- runtime 级 `fork()` / `navigateTree()`

---

## 2. 核心概念

### 2.1 leaf

`leaf` 表示当前正在看的节点位置。

要求：

- append 新 entry 时，默认挂在当前 leaf 下
- `/tree` 导航本质上就是切换 leaf
- `buildSessionContext()` 总是基于当前 leaf 对应路径构建上下文

### 2.2 branch

branch 不是单独存成一个对象，而是：

```text
从 root 到当前 leaf 的唯一路径
```

### 2.3 tree

tree 是 session file 中全部 entry 通过 `parentId` 连接起来的结果。

要求：

- 同一个 session file 内可以有多条 branch
- 不允许一条 branch 的新操作篡改另一条 branch 的旧历史

---

## 3. `getBranch()` 与 `getTree()` 需求

### `getBranch(fromId?)`

要求：

- 从指定节点或当前 leaf 向上回溯到 root
- 返回 root-first 的 path array
- path 中保留 message / compaction / branch_summary / model_change / thinking_level_change 等全部相关 entry

### `getTree()`

要求：

- 返回整个 session 的树结构
- 供 `/tree` UI 使用
- child 节点按时间排序
- orphaned entry 需要有容错策略

---

## 4. `/tree` 导航需求

### 4.1 不 summary 的 tree navigation

当用户从当前 leaf 切回旧节点，但选择**不生成 summary**时，行为应为：

- 仅切换 leaf
- 不新增 entry
- 重新构建当前 context
- 旧 branch 保持不变

等价语义：

- 导航到某个非 root 节点：`branch(targetId)`
- 导航到最开头之前：`resetLeaf()`

### 4.2 summary 的 tree navigation

当用户从当前 leaf 切回旧节点，并选择**生成 summary**时，行为应为：

1. 计算被放弃 branch 的 entry 范围
2. 生成 branch summary 文本
3. 在目标位置追加一个 `branch_summary` entry
4. 让当前 leaf 指向这个新的 summary 节点
5. 重新构建 context

这意味着：

- `branch_summary` 挂在**目标 branch** 上
- 它的语义是“我刚从另一条 branch 回来，这里是那条 branch 的摘要”

---

## 5. `branch_summary` 的角色

`branch_summary` 是 first-class session entry，不是临时 UI 注释。

### 5.1 进入上下文

要求：

- `buildSessionContext()` 必须识别 `branch_summary`
- 它进入 LLM context 时应转成一条 summary message

### 5.2 参与后续 compaction

要求：

- `branch_summary` 在 compaction 中应被当成 message-like 内容
- 它可以被保留为 recent suffix
- 也可以被折叠进新的 compaction summary

### 5.3 保存来源信息

建议：

- 保留 `fromId`
- 可选保留 read / modified files 等 `details`

---

## 6. `/fork` 需求

`/fork` 和 `/tree` 不同。

### `/tree`

- 仍在同一个 session file 内
- 只是切 leaf 或追加 branch_summary

### `/fork`

- 生成新的 session file
- 新 session 记录 `parentSession`
- 旧 session 不被修改

### 6.1 fork from user message

如果目标节点是 user message，要求：

- 可以从该 user message 之前的位置开始新 branch
- 把该 user message 文本返回给 UI 预填 editor

### 6.2 session file 派生

新 session file 的要求：

- 只包含从 root 到目标 leaf 的那条路径
- label 等附加信息按需要一并复制
- header 中记录 `parentSession`

---

## 7. branch summary 的生成流程需求

参考 `pi` 的做法，推荐流程为：

1. 从 oldLeaf 到 common ancestor 收集被放弃的 entries
2. 把这些 entries 变成可总结的 message 序列
3. 控制 token budget，优先保留较新的内容
4. 生成结构化 branch summary
5. 把 summary 作为 `branch_summary` entry 落盘

### 关键要求

- 必须计算 common ancestor
- 必须只总结“被放弃的那段 branch”
- 不应把整个 session 全量重新总结

---

## 8. label 和 session title

虽然这两项不是 tree 主路径的核心，但如果目标是接近 `pi`，建议一起实现。

### label

用途：

- 给节点打书签
- tree 中快速识别关键节点
- 便于导航

要求：

- label 改变通过 `label` entry 表达
- 清除 label 也通过 append entry 表达

### session title

用途：

- `/resume` selector 中显示更友好的会话名称

要求：

- 标题通过 `session_info` entry 持久化
- 不是 header 字段

---

## 9. 验收场景

### 场景 A：同文件分支

```text
a -> b -> c -> d -> e
          \
           f -> g -> h -> i
```

要求：

- 可以在 `e` 和 `i` 之间来回切换
- 任一分支继续对话都不会破坏另一条分支

### 场景 B：带 branch summary 返回

从 `i` 回到 `e`，选择 summary。

要求：

- 在 `e` 后产生一个 `branch_summary` 节点
- 继续对话时，模型能看到“被放弃 branch 的总结”

### 场景 C：fork

从某个旧节点 fork 出新 session。

要求：

- 生成新文件
- 旧文件不变
- 新文件中 `parentSession` 正确

---

## 10. 非目标与边界

本文件不要求：

- tree UI 组件实现细节
- 多 session merge
- Git 风格 merge/rebase 语义

只要求：

```text
同一 session file 内的树导航 + 跨文件 fork 能成立
```
