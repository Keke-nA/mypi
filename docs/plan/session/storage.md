# Session 存储与持久化需求

## 1. 目标

session 存储层的目标是提供一个**append-only、可迁移、可列出、可恢复、支持分支树结构**的本地持久化系统。

对齐 `pi` 的能力时，建议对标：

- `SessionHeader`
- `SessionEntryBase`
- typed session entries
- `SessionManager.create/open/continueRecent/inMemory/forkFrom/list/listAll`

参考：

- `pi-mono/packages/coding-agent/src/core/session-manager.ts`
- `pi-mono/packages/coding-agent/src/config.ts`

---

## 2. 目录结构需求

### 2.1 顶层目录

建议默认目录：

```text
~/.mypi/agent/sessions/
```

如果希望与 `pi` 保持语义一致，建议 session root 放在：

```text
<agentDir>/sessions/
```

### 2.2 每个工作目录的 session 子目录

建议像 `pi` 一样，按 `cwd` 派生 session 子目录，而不是把所有 session 平铺到一个目录里。

原因：

- 便于 `/resume` 时优先展示当前项目相关 session
- 同名文件项目之间不冲突
- session listing 可以分本地项目与全局两类

建议编码形式：

```text
--home-user-project-a--
--home-user-project-b--
```

不要求完全照搬 `pi` 的编码规则，但要求：

- 路径可逆或至少可读
- 路径安全
- Linux / macOS / Windows 风格路径都能稳定编码

---

## 3. 文件格式需求

### 3.1 必须使用 append-only JSONL

每个 session file 必须是：

- 纯文本
- 一行一个 JSON object
- 第一行是 session header
- 后面每行是一个 typed entry

推荐扩展名：

```text
*.jsonl
```

### 3.2 为什么必须是 JSONL

原因：

- append 新 entry 成本低
- 崩溃恢复相对简单
- 易于迁移
- 易于手工检查和调试
- 与 `append-only history` 语义天然一致

### 3.3 文件顺序不等于树顺序

必须强调：

- 文件顺序只是 append log 顺序
- 树结构由 `id / parentId` 决定
- 不允许依赖“相邻两行就是父子关系”

---

## 4. SessionHeader 需求

header 至少应包含：

```ts
interface SessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}
```

### 字段要求

- `type`
  固定为 `session`，用于和普通 entry 区分
- `version`
  用于迁移
- `id`
  session 文件级唯一 ID
- `timestamp`
  session 创建时间
- `cwd`
  session 启动时所在工作目录
- `parentSession`
  用于跨 session file 的 lineage，例如 `/fork`

### 设计要求

- header 是文件级元信息，不参与 tree traversal
- header 不应频繁修改
- 用户后续设置的 title / label 等不应回写 header，而应通过 entry 追加

---

## 5. Typed Entry 需求

每个 entry 都必须包含：

```ts
interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

### 5.1 必须实现的 entry 类型

#### `message`

承载真正的 AgentMessage。

用途：

- user
- assistant
- toolResult
- 以及产品扩展消息（如 bashExecution）

#### `thinking_level_change`

记录 thinking level 变化。

要求：

- 不能只保存在运行时内存
- reload / resume 后必须可恢复

#### `model_change`

记录模型切换。

要求：

- 不能只保存在 settings
- session 恢复时必须能重建“当时当前分支上的模型状态”

#### `compaction`

记录 compact checkpoint。

必须包含：

- `summary`
- `firstKeptEntryId`
- `tokensBefore`

#### `branch_summary`

记录 `/tree` 导航时对被放弃分支的摘要。

必须包含：

- `fromId`
- `summary`
- 可选 `details`

#### `custom`

扩展私有持久化 entry。

要求：

- 不进入 LLM context
- 只用于扩展重建自身状态

#### `custom_message`

扩展注入到 LLM context 的内容。

要求：

- 会进入 `buildSessionContext()`
- 与 `custom` 区分开

#### `label`

节点标签，用于 tree bookmark / navigation。

要求：

- 设置 label 通过 append entry 实现
- 清除 label 也通过 append entry 实现，不允许原地改旧数据

#### `session_info`

session 元信息，例如显示名称。

要求：

- 显示名称不是 header 字段
- 通过 append entry 更新

---

## 6. 存储不变量

### 6.1 append-only

实现必须满足：

- 正常业务路径不删除旧 entry
- 正常业务路径不修改旧 entry
- session 的“变化”通过 append 新 entry 表达

### 6.2 唯一 ID

- 每个 entry 的 `id` 必须唯一
- 允许使用 UUID 或短 UUID
- 必须能避免冲突

### 6.3 `parentId`

- root entry 的 `parentId = null`
- 非 root entry 必须指向同一 session 中的已有节点
- append 新 entry 时，默认挂到当前 leaf

### 6.4 `leaf` 不是独立持久化字段

如对齐 `pi`，建议：

- 当前 leaf 作为 runtime state 管理
- 打开 session 文件时，默认把最后一个 entry 视为当前 leaf
- `/tree` 导航后的 leaf 切换，需要通过新 entry 或后续会话继续操作体现

### 6.5 版本迁移

必须支持：

- 根据 `header.version` 判定迁移逻辑
- 低版本文件打开时自动迁移
- 必要时 rewrite 文件

---

## 7. Session 查询能力

### 7.1 create / open / continueRecent / inMemory

必须支持：

- `create(cwd, sessionDir?)`
- `open(path, sessionDir?)`
- `continueRecent(cwd, sessionDir?)`
- `inMemory(cwd?)`

### 7.2 forkFrom

必须支持跨 session file 派生：

- 从 source session 复制整棵有效内容或指定范围
- 在目标 cwd 下创建新 session file
- 新 header 中写 `parentSession`

### 7.3 list / listAll

必须支持：

- 当前项目 session 列表
- 全局 session 列表

列表项至少应包含：

- path
- id
- cwd
- name
- created
- modified
- messageCount
- firstMessage
- allMessagesText

这是后续 `/resume`、selector、fuzzy search 的基础。

---

## 8. 持久化策略需求

### 8.1 append 写入

建议：

- 追加单条 entry 时优先 append
- 仅在迁移、repair、branched session 提取时 rewrite 文件

### 8.2 崩溃与损坏容忍

必须考虑：

- 空文件
- 只有 header 没有 entry
- malformed line
- header 缺失或非法

要求：

- 尽量忽略坏行，不让整个 session 完全不可用
- 明确损坏修复策略

### 8.3 assistant 前是否延迟 flush

`pi` 的一个行为细节是：

- 在还没有 assistant message 之前，session file 可以暂不真正 flush
- 等 assistant 出现后再整体写出

这不是 session 语义必需项，但如果目标是行为接近 `pi`，可以保留。

对 `mypi` 的建议：

- 第一版可直接 append header + entries
- 如果后续需要对齐 `pi` 的“只在有实际回答后再算持久 session”语义，再补延迟 flush

---

## 9. 验收标准

- 每个 session file 都是合法 JSONL
- header 和 entries 能稳定 parse
- entry tree 只由 `id / parentId` 决定
- list / recent / open / forkFrom 都能工作
- 老版本 session file 打开后能迁移到新版本
- append-only 约束不被破坏
- 对 tree / compaction / runtime 的后续实现提供稳定底座
