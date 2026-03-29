# Coding-Agent 层说明

对应代码：

- `package/coding-agent/src`
- 包名：`@mypi/coding-agent`
- CLI：`mypi`

---

## 0. 快速启动

以下命令都假设你当前就在仓库根目录：

```bash
cd ~/mypi
```

### 先构建

首次运行，或者改过代码后，先构建：

```bash
npm run build --workspace @mypi/coding-agent
```

### 直接用 `node` 启动 coding-agent

最直接的启动方式是：

```bash
node package/coding-agent/dist/cli/main.js
```

常见变体：

```bash
# 强制 TUI
node package/coding-agent/dist/cli/main.js --tui

# 强制 plain CLI
node package/coding-agent/dist/cli/main.js --plain

# 跑一个单次 prompt
node package/coding-agent/dist/cli/main.js --prompt "Summarize this repo"
```

### 如果想让 shell 里的 `mypi` 直接启动 coding-agent

当前包已经声明了：

```json
"bin": {
  "mypi": "./dist/cli/main.js"
}
```

所以有两种常见做法。

#### 做法 A：最简单，给 shell 加 alias

```bash
alias mypi='node ~/mypi/package/coding-agent/dist/cli/main.js'
```

加到你的 `~/.zshrc` 或 `~/.bashrc` 里后，重新开 shell，就可以直接：

```bash
mypi
mypi --tui
mypi --prompt "Summarize this repo"
```

#### 做法 B：用 npm link 暴露 bin

```bash
cd ~/mypi
npm link --workspace @mypi/coding-agent
```

之后也可以直接：

```bash
mypi
```

如果只是你自己本机开发使用，通常 **alias 更直接、更容易理解**。

这是整个项目里最关键的一层。

如果 `ai` 是“模型协议层”，`agent` 是“单 Agent 编排层”，那么 `coding-agent` 就是：

> “真正把它们装配成一个可用 coding assistant 产品”的那一层。

---

## 1. 这一层主要负责什么

`coding-agent` 这一层负责把下面这些东西组装起来：

- `@mypi/ai`
- `@mypi/agent`
- workspace tools
- session persistence
- branch / fork / navigate
- auto-compaction
- summary generation
- config loading
- CLI
- TUI

所以它不是一个小薄封装，而是整个项目的 **产品核心层**。

---

## 2. 这一层对外主要提供什么

入口：`package/coding-agent/src/index.ts`

当前真正重要的对外能力有：

### session 核心

- `AgentSession`
- `SessionRuntime`
- `SessionManager`
- `Session*` 各类类型

### session 辅助

- `buildSessionContext(...)`
- `createBranchSummaryGenerator(...)`
- `createCompactionSummaryGenerator(...)`
- `resolveModel(...)`
- `resolvePersistedModel(...)`

### 产品装配

- `createCodingSystemPrompt(...)`
- `createWorkspaceTools(...)`
- `loadAgentConfig(...)`
- `formatLoadedConfig(...)`

### UI / CLI

- `InteractiveApp`
- CLI 入口：`src/cli/main.ts`

如果要用一句话讲“这一层的公开接口长什么样”，最准确的说法是：

> 它对外提供的是一套 session-aware 的 coding-agent runtime，以及围绕它的工具、配置和交互入口。

---

## 3. 这层最关键的三个类

用户提到的“那三个 session 啥啥啥的”，就是这一层最值得讲清楚的地方：

- `SessionManager`
- `SessionRuntime`
- `AgentSession`

这三个不是重复设计，而是明确分工。

---

## 4. `SessionManager`：持久化和树结构

代码位置：`package/coding-agent/src/core/session-manager.ts`

### 它负责什么

`SessionManager` 负责：

- 创建/打开 session 文件
- 维护 session header
- 维护线性 JSONL entries
- 用 `parentId` 构造出树结构
- 切换 `leafId`
- fork 新 session
- 删除 session 文件
- 提供 session list / info

### 它的本质

它本质上是：

> “一个基于 JSONL 的 session tree store”。

### 文件结构

session 文件第一行是 header：

- `type: "session"`
- `version`
- `id`
- `timestamp`
- `cwd`
- `parentSession?`

后面每一行都是 entry。

### entry 类型

当前支持这些 entry：

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `session_info`

### 关键设计点

它不是单纯 append 一串聊天记录，而是把每条 entry 都挂在：

- `id`
- `parentId`

之上。

因此虽然底层存储是线性的 JSONL，逻辑上却是一棵树。

这点非常适合面试里讲，因为它体现了：

- 存储格式简单
- 分支能力明确
- 可恢复、可遍历、可 fork

### 你可以把它理解成

```text
Git commit graph 的简化版会话树存储
```

只是对象不是代码提交，而是对话/控制事件。

---

## 5. `SessionRuntime`：把 Agent 和 SessionManager 连起来

代码位置：`package/coding-agent/src/core/session-runtime.ts`

### 它负责什么

`SessionRuntime` 的职责是：

- 管理当前活动的 `SessionManager`
- 订阅 `AgentEvent`
- 把可持久化消息写回 session
- 在 session 切换/恢复时，把 session 内容恢复进 agent
- 管理自动 compaction
- 管理 session 级 model / thinking level / label / name 变更

### 它的本质

它本质上是：

> “Agent 与 Session 持久化之间的编排层”。

### 为什么需要它

如果只有 `SessionManager`，那只是个存储器；
如果只有 `Agent`，那只是个运行时。

`SessionRuntime` 把这两者连接起来，保证：

- agent 运行过程中的消息能落盘
- 重新打开 session 时能恢复上下文
- model / thinking / branch 状态不会丢

### 关键机制

#### 1. 创建时恢复
`SessionRuntime.create(...)` 会：

- 打开或创建 `SessionManager`
- 如果是新 session，先写初始 model / thinking level
- 再调用 `restoreIntoAgent()` 把 session 内容恢复到 agent

#### 2. 运行中持久化
它订阅 `AgentEvent`：

- `message_end` 时把 message append 到 session
- `turn_end` 时判断是否要 auto-compaction
- `agent_end` 时真正触发 auto-compaction

#### 3. 切换和 fork
它支持：

- `newSession()`
- `switchSession()`
- `fork()`
- `navigateTree()`

这些操作都会先：

- 中止 agent
- 等待空闲
- 清空队列
- 然后切换 manager
- 再 restore 回 agent

所以 session 切换不是简单换个文件路径，而是一个完整的运行时切换动作。

---

## 6. `AgentSession`：给上层用的高层 facade

代码位置：`package/coding-agent/src/core/agent-session.ts`

### 它负责什么

`AgentSession` 负责把：

- `Agent`
- `SessionRuntime`

包成一个更容易直接使用的高层对象。

### 它对上层暴露什么

- `prompt(...)`
- `continue()`
- `abort()`
- `waitForIdle()`
- `newSession()`
- `switchSession()`
- `listAllSessions()`
- `deleteSession()`
- `fork()`
- `navigateTree()`
- `compact()`
- `setModel()`
- `setThinkingLevel()`
- `setSessionName()`
- `setLabel()`
- `getContextUsage()`
- `subscribeRuntime(...)`

### 为什么需要它

如果上层直接碰 `Agent + SessionRuntime + SessionManager`，会比较重。

`AgentSession` 的作用就是提供一个统一、够高层的入口，让 CLI、TUI、mom 都能比较简单地使用整套 session-aware agent 能力。

### 你可以这样记

- `SessionManager`：存储层
- `SessionRuntime`：运行时编排层
- `AgentSession`：上层门面层

这是这一层最值得讲清楚的结构。

---

## 7. session 上下文是怎么恢复出来的

代码位置：

- `core/session-context.ts`
- `core/messages.ts`

### `buildSessionContext(...)`
它会根据：

- 全量 entries
- 当前 `leafId`

恢复出当前分支上的逻辑上下文，包括：

- `messages`
- `thinkingLevel`
- `model`
- `branch`

### 一个很关键的点

这一层并不是简单把所有历史消息都塞回去，而是会处理：

- `model_change`
- `thinking_level_change`
- `branch_summary`
- `compaction`
- `custom_message`

尤其是：

- `compaction` 会被恢复成 `compaction_summary` message
- `branch_summary` 会被恢复成 `branch_summary` message

然后再通过 `convertToLlm(...)` 变成真正给模型看的消息。

这说明这一层已经不是“聊天记录”思维，而是“会话状态图 + 派生消息”思维。

---

## 8. branch summary 和 compaction 是怎么做的

代码位置：

- `core/branch-summarization.ts`
- `core/session-compaction.ts`
- `core/summary-generators.ts`

### branch summary
用途：

- 当用户从旧节点切换到另一分支时
- 先把离开的那条分支总结成摘要
- 再把摘要注入到新上下文里

这样可以减少长上下文浪费，同时保留“之前试过什么”。

### compaction
用途：

- 上下文太长时，把较早的历史压缩成 rolling summary
- 保留最近一段 suffix 原文
- 前面的内容变成 compaction summary

### 当前实现方式

这两种 summary 最终都是：

- 调用当前 model
- 让 model 自己生成摘要文本
- 再落为 session entry
- 恢复时转为 injected message

这说明：

> 这一层已经具备“让模型辅助维护自己会话状态”的能力。

---

## 9. context usage 和 auto-compaction

代码位置：`core/context-usage.ts`

这一层会估算当前上下文 token 占用，并提供：

- `getContextUsageSnapshot(...)`
- `resolveAutoCompactionSettings(...)`
- `shouldAutoCompact(...)`
- `isContextOverflowError(...)`

### auto-compaction 的触发方式

当前支持两种来源：

- 超过阈值（threshold）
- 出现 context overflow 错误后重试（overflow + retry）

注意，这里的自动恢复仍然只针对 overflow；`401/404` 之类普通 provider 错误不会自动重试，只会把已经产生的 assistant partial 按上面的规则保留进 session。

然后 `SessionRuntime` 在 `agent_end` 后触发 compaction，并在需要时自动 `continue()` 重试。

另外，普通错误场景下还有一个和用户体验很相关的细节：

- `message_end` 时，assistant error message 也会照常写入 session/jsonl
- 如果这条 error message 在中断前已经输出过部分正文，这部分正文会保留在 `assistant.content` 里
- session 恢复后，这条消息仍然在分支上下文中
- 真正再次发给模型时，`ai` 层会只重放其中已经可见的 `text`，不重放未完成的 `thinking/toolCall`

所以像“输出到一半 401/连接断开，下一轮用户输入继续”这种场景，当前语义是：

> session 会保留这条中断的 assistant；下一轮模型会看到它已经输出出来的正文部分，并从这个可见上下文继续。

这是一套相当完整的“长会话自维护”机制。

---

## 10. workspace tools 是怎么接进来的

代码位置：`tools/workspace-tools.ts`

当前内建工具：

- `read`
- `write`
- `edit`
- `bash`

### 特点

- 都限制在 workspace root 内
- `read` 支持文件读取和目录 listing
- `write` 自动建父目录
- `edit` 做精确字符串替换
- `bash` 在 workspace 里执行 shell 命令

所以 `coding-agent` 层不仅有 agent loop，还有“面向代码仓库操作”的默认工具集。

这也是它和纯聊天 Agent 的核心区别之一。

---

## 11. 配置系统

代码位置：`config/config.ts`

当前会加载：

- `~/.mypi/agent/config.json`
- `~/.mypi/agent/presets.json`
- `<cwd>/.mypi/config.json`
- `<cwd>/.mypi/presets.json`
- 环境变量
- CLI 参数

支持的内容包括：

- provider（当前支持 `openai` / `anthropic`）
- API key
- baseUrl
- model
- thinkingLevel
- uiMode
- sessionDir
- continueRecent
- activeTools
- `systemPromptAppend`
- compaction settings
- presets

配置来源现在既支持传统的 `openai.*`，也支持 `anthropic.*`，并允许通过 `agent.provider` 明确选中当前 provider。

环境变量也已经支持：

- `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL`
- `ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL`

一个很实用的变化是：如果当前 provider 已知，但 model id 不在内建 registry 里，`coding-agent` 不会直接报错，而是会按 provider 构造一个兼容模型继续运行。所以像 `kimi-k2.5` 这类 Anthropic-compatible 模型既可以做成内建模型，也可以在未注册时先按自定义模型跑起来。

这让 `coding-agent` 已经不只是一个库，而是一个有完整产品配置入口的系统。

---

## 12. CLI 和 TUI

代码位置：

- `src/cli/main.ts`
- `src/ui/interactive-app.ts`

### CLI 模式
支持：

- 单 prompt 执行
- plain 交互
- session 命令
- `--provider` 选择 provider
- tree / fork / compact / model / thinking / name 等命令

CLI 现在已经不是 OpenAI-only，而是 provider-aware：

- 会按当前 provider 配置 `configureAI(...)`
- `model` 解析会走通用 `resolveModel(...)`
- 恢复历史 session 时会走 `resolvePersistedModel(...)`
- model chooser 会保留当前自定义模型名，不会因为它不在默认列表里就丢失

### TUI 模式
基于 `pi-tui` 提供：

- transcript 区
- editor 区
- notices
- session selector overlay
- session tree overlay
- model / thinking 选择器

TUI 的 model 选择器现在也已经 provider-aware，会优先显示当前 provider 的内建模型，同时保留当前 session 正在使用的模型名。

所以 `coding-agent` 这层已经同时具备：

- 底层 runtime
- 本地产品交互入口

---

## 13. 这一层在整个项目中的位置

这一层向下依赖：

- `@mypi/ai`
- `@mypi/agent`
- `@mariozechner/pi-tui`

这一层向上被：

- CLI 直接使用
- `mom` 间接复用

所以从架构角度说，它是整个项目的 **中心层**。

如果没有它：

- `ai` 只有模型协议
- `agent` 只有 turn loop
- 但不会变成一个真的 coding assistant 产品

---

## 14. 当前可以怎么总结这层

面试里最推荐的说法是：

> `@mypi/coding-agent` 是整个项目的产品核心层。它把统一 AI 协议层和单 Agent 编排层装配成一个 session-aware coding assistant，核心由 `SessionManager / SessionRuntime / AgentSession` 三层组成：`SessionManager` 负责 JSONL 树状持久化，`SessionRuntime` 负责 Agent 与 session 的双向同步和 auto-compaction，`AgentSession` 则提供上层易用的统一接口。再往上，它补上 workspace tools、config、CLI 和 TUI，形成一个真正可交互、可恢复、可分支的 coding-agent。 

---

## 15. 关键代码位置

- `package/coding-agent/src/core/agent-session.ts`
- `package/coding-agent/src/core/session-runtime.ts`
- `package/coding-agent/src/core/session-manager.ts`
- `package/coding-agent/src/core/session-types.ts`
- `package/coding-agent/src/core/session-context.ts`
- `package/coding-agent/src/core/session-compaction.ts`
- `package/coding-agent/src/core/branch-summarization.ts`
- `package/coding-agent/src/core/summary-generators.ts`
- `package/coding-agent/src/tools/workspace-tools.ts`
- `package/coding-agent/src/config/config.ts`
- `package/coding-agent/src/cli/main.ts`
- `package/coding-agent/src/ui/interactive-app.ts`
