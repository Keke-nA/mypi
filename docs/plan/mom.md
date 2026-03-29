# Mom 复现计划

补充说明：

- 本文面向 `mypi` 当前已有代码状态，不再从零重新规划 `AI`、`Agent`、`TUI`、`Coding-Agent` 四层。
- 当前目标是在 `mypi` 现有 `OpenAI-compatible` 栈之上，复现 `pi-mono/packages/mom` 的核心产品能力。
- 本文默认：`mom` 先固定使用 `OpenAI`，暂不复现 `Anthropic`、`/login`、`auth.json`、`AuthStorage`、`ModelRegistry` 等上游 provider / auth 体系。
- `mom` 在 `mypi` 中的定位不是替代现有 `coding-agent CLI`，而是在其 core 能力之上新增一个 `Slack + workspace + sandbox + scheduler` 运行时。

## 1. 目标

`mom` 层的目标，是在 `@mypi/ai`、`@mypi/agent`、`@mypi/coding-agent` 的基础上，新增一个可长期运行的 Slack 机器人运行时，使其具备接近 `pi-mono` 中 `mom` 的使用体验。

这一层完成后，`mypi` 将同时具备两种上层产品形态：

- `coding-agent CLI`：面向本地终端交互
- `mom`：面向 Slack 会话、定时任务和长期工作区运行

`mom` 的核心不是再做一套新的 Agent，而是把现有 Agent core 放进一个新的宿主环境中，并补齐下面这些能力：

- Slack 接入
- 每 channel / DM 独立上下文
- `log.jsonl` / `context.jsonl` 双层历史
- Docker / host sandbox
- 附件下载与上传
- `MEMORY.md` / `skills` 持久化工作区
- 事件唤醒系统
- Slack 主消息 + 线程日志输出

## 2. 当前前提与差距

## 2.1 当前已经具备的基础

`mypi` 当前已经有足够多的基础能力，可以直接作为 `mom` 的内核复用：

- `@mypi/ai`
  - 已具备 `OpenAI-compatible` provider 能力
  - 已具备统一 `stream` 协议和消息类型
- `@mypi/agent`
  - 已具备 Agent turn loop
  - 已具备工具调用与 `AbortSignal` 通路
  - 已具备结构化运行时事件
- `@mypi/coding-agent`
  - 已具备 `AgentSession`
  - 已具备 `SessionRuntime`
  - 已具备 `SessionManager`
  - 已具备 auto-compaction
  - 已具备分支 / session 基础能力
- `coding-agent` 当前工作区工具
  - 已有 `read` / `write` / `edit` / `bash`
  - 这些工具的部分逻辑可以借鉴，但不能直接作为 `mom` 最终工具层

换句话说，`mom` 当前不缺 Agent 内核，缺的是外层 harness。

## 2.2 当前明确缺失的能力

相对于 `pi-mono/packages/mom`，`mypi` 当前还缺少：

- `package/mom` 独立包
- Slack Socket Mode / Web API 接入
- per-channel runner / queue / stop 调度
- `log.jsonl -> context.jsonl` 同步链路
- `MEMORY.md` / `skills` 发现与注入
- sandbox executor（`host` / `docker:<name>`）
- mom 专用工具层
  - 带 `label` 的 `read` / `bash` / `edit` / `write`
  - `attach`
  - 图片读取
  - Slack 友好的输出截断
- Slack 附件下载与回传
- 启动 backfill
- `events/` 调度系统
- mom 专用 system prompt
- Slack 主消息 / 线程日志编排

## 3. 职责边界

## 3.1 本层负责

- 装配 Slack transport、channel state、workspace store、sandbox、scheduler
- 复用 `@mypi/coding-agent` 的 session / compaction 能力，改造成固定 `context.jsonl` 工作流
- 提供 `mom` 专用工具集合
- 维护每个 channel 独立的工作区、记忆、技能、附件和上下文
- 把 Agent 事件翻译成 Slack 主消息和线程消息
- 提供适合 Slack / 长期运行 / 定时唤醒的产品语义

## 3.2 本层不负责

- 重写 `@mypi/ai` provider 协议
- 重写 `@mypi/agent` 的 turn loop
- 重写 `@mypi/coding-agent` 的 compaction / session tree 算法
- 复用或嵌入 `pi-tui` 到 `mom` 运行时
- 在当前阶段实现多 provider / 登录体系

## 3.3 与现有 `coding-agent` 的关系

- `coding-agent` 继续承担 CLI / TUI 产品形态
- `mom` 复用 `coding-agent` 的 core，而不是复用其 CLI
- `mom` 是建立在 `coding-agent core` 之上的新产品层，而不是 `coding-agent` 的一个 UI mode

## 4. 当前版本的范围决策

为了尽快复现 `mom` 核心闭环，当前计划做如下约束：

### 当前要复现的能力

- Slack `@mention` / DM
- per-channel 独立工作区
- `log.jsonl` 与 `context.jsonl`
- 自动同步未见消息到 context
- `MEMORY.md`
- `skills/`
- `read` / `write` / `edit` / `bash` / `attach`
- Slack 附件下载与上传
- host / docker sandbox
- 启动 backfill
- 事件系统（`immediate` / `one-shot` / `periodic`）
- 主消息 + 线程工具日志
- stop / abort
- auto-compaction 复用

### 当前先不做的能力

- `Anthropic`
- `/login`
- `auth.json`
- provider 注册中心扩展
- mom 自己独立的一套复杂模型配置系统
- Web UI / TUI 内嵌到 mom 运行时

### 当前 provider 决策

- `mom` 先固定走 `OpenAI-compatible`
- 直接复用 `@mypi/ai` 当前 provider
- 默认读取：
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`（可选）
- Slack 侧新增：
  - `MOM_SLACK_APP_TOKEN`
  - `MOM_SLACK_BOT_TOKEN`

## 5. 目录与包规划

建议新增：

```text
package/
  mom/
    src/
      main.ts
      slack.ts
      agent.ts
      context.ts
      store.ts
      sandbox.ts
      events.ts
      log.ts
      tools/
        index.ts
        read.ts
        write.ts
        edit.ts
        bash.ts
        attach.ts
        truncate.ts
    test/
```

### 文件职责

- `src/main.ts`
  - CLI 参数解析
  - 环境变量校验
  - 启动 SlackBot、EventsWatcher、channel runner cache
- `src/slack.ts`
  - Socket Mode 接入
  - `app_mention` / `message.im` / 普通消息日志
  - `post/update/delete/upload`
  - per-channel queue
  - 启动 backfill
- `src/agent.ts`
  - 创建 / 缓存每 channel 的 `AgentRunner`
  - 组装 mom 的 system prompt
  - 连接 `AgentSession`、memory、skills、attachments、usage、thread 输出
- `src/context.ts`
  - `log.jsonl -> context.jsonl` 同步
  - 工作区级 `settings.json` 读取 / 写入桥接
- `src/store.ts`
  - `log.jsonl` 持久化
  - 附件下载排队
  - channel 目录管理
- `src/sandbox.ts`
  - `host` / `docker:<name>` executor
  - host 路径与容器路径映射
- `src/events.ts`
  - `events/` 监听与调度
  - `immediate` / `one-shot` / `periodic`
- `src/log.ts`
  - console 日志
- `src/tools/*`
  - mom 专用工具实现
  - 带 `label`
  - Slack 友好输出
  - 支持图片、上传、sandbox 路径

## 6. 工作区布局

`mom` 应采用和上游接近的工作区布局：

```text
<working-directory>/
  MEMORY.md
  SYSTEM.md
  settings.json
  skills/
  events/
  C123ABC/
    MEMORY.md
    log.jsonl
    context.jsonl
    attachments/
    scratch/
    skills/
  D456DEF/
    MEMORY.md
    log.jsonl
    context.jsonl
    attachments/
    scratch/
    skills/
```

### 关键语义

- `log.jsonl`
  - source of truth
  - 记录用户消息和 bot 最终回复
  - 不记录完整 tool result
  - 不压缩
- `context.jsonl`
  - 真正送入模型的持久化上下文
  - 包含工具结果
  - 允许 compaction
- `MEMORY.md`
  - 工作规则、偏好、长期知识
- `skills/`
  - bot 自己写出来的可复用 CLI 工具
- `attachments/`
  - Slack 文件下载落地目录
- `scratch/`
  - 当前 channel 的工作目录
- `SYSTEM.md`
  - 环境改动日志

## 7. 运行时架构

## 7.1 高层结构

```text
Slack Socket Mode
  -> SlackBot
    -> ChannelQueue
      -> AgentRunner
        -> AgentSession / SessionRuntime / SessionManager
          -> @mypi/agent
            -> @mypi/ai
```

同时并行存在：

```text
workspace/events/*.json
  -> EventsWatcher
    -> synthetic SlackEvent
      -> ChannelQueue
```

## 7.2 单次消息处理流程

1. Slack 收到 `@mention` 或 DM。
2. 先把消息写入 `<channel>/log.jsonl`。
3. 若存在附件，先登记路径并异步下载到 `attachments/`。
4. 若当前 channel 正在运行：
   - 用户消息返回 busy 提示
   - 事件消息进入队列等待
5. channel 空闲时，创建或复用 `AgentRunner`。
6. 运行前执行 `syncLogToContext()`：
   - 将 `log.jsonl` 中未见过的用户消息同步进 `context.jsonl`
7. 读取：
   - workspace `MEMORY.md`
   - channel `MEMORY.md`
   - workspace / channel `skills`
8. 生成 mom system prompt。
9. 把当前消息和附件送入 `AgentSession.prompt()`。
10. Agent 运行时事件映射到：
    - Slack 主消息
    - Slack 线程工具日志
11. 最终回复写回 `log.jsonl`。
12. tool result 和上下文演化保留在 `context.jsonl`。

## 7.3 `context.jsonl` 与现有 `SessionManager` 的关系

当前 `mypi` 已有 `SessionManager`，但默认语义偏向 session tree 文件；`mom` 这里不新造一套持久化，而是直接复用它，只是换成固定文件路径：

- 每个 channel 固定一个 `context.jsonl`
- 初始化时：
  - 若文件不存在：先调用 `SessionManager.create({ cwd: channelDir, filePath: contextFile, sessionDir: workspaceDir })`
  - 再通过 `AgentSession.create({ sessionFile: contextFile, ... })` 打开
- 后续始终复用这个固定 `context.jsonl`

这样可以直接继承：

- message 持久化
- model / thinking level change 持久化
- compaction
- context rebuild

## 8. 与现有代码的复用策略

## 8.1 直接复用

### `@mypi/coding-agent`

直接复用：

- `AgentSession`
- `SessionRuntime`
- `SessionManager`
- `convertToLlm`
- compaction 能力
- branch / context rebuild 相关基础设施

### `@mypi/agent`

直接复用：

- Agent loop
- tool execution events
- abort / continue / queue 语义

### `@mypi/ai`

直接复用：

- `OpenAI-compatible` provider
- 统一消息类型
- 图片消息结构

## 8.2 部分复用

### `coding-agent` 配置

当前建议：

- `mom` 先复用 `@mypi/coding-agent` 的 `loadAgentConfig()` 读取 `OPENAI` 相关配置
- `mom` 自己只新增 Slack 与 sandbox 启动参数

可复用字段：

- `apiKey`
- `baseUrl`
- `modelId`
- `thinkingLevel`
- compaction settings

### `workspace-tools`

不能直接拿来作为 mom 最终工具层，但可以复用部分思路：

- 路径约束
- 读写文件基本逻辑
- `bash` 超时控制

不能直接复用的原因：

- 没有 `label`
- 没有 `attach`
- 没有 Slack 线程友好的 details 设计
- 没有图片读取能力
- 没有 docker path translation
- 没有和 Slack upload / attachment download 打通

## 8.3 明确需要新写

以下模块建议新写，不要强行塞回 `coding-agent`：

- `package/mom/src/slack.ts`
- `package/mom/src/store.ts`
- `package/mom/src/context.ts`
- `package/mom/src/sandbox.ts`
- `package/mom/src/events.ts`
- `package/mom/src/tools/*`
- `package/mom/src/agent.ts`

## 9. 关键设计决策

## 9.1 每个 channel 一个长期 runner

- 以 `channelId` 为 key 缓存 `AgentRunner`
- 每个 channel 一个独立 `AgentSession`
- 保证上下文、memory、skills、附件目录天然隔离

## 9.2 用户消息与事件消息分开处理

- 用户消息：如果当前 channel 正忙，直接返回 busy 提示
- 事件消息：始终进队列，最多 5 个

## 9.3 `log.jsonl` 永远是事实来源

即使 bot 正忙，也要先把消息记到 `log.jsonl`。

这样做有两个目的：

- 不丢历史
- 下一次运行前可通过 `syncLogToContext()` 补齐上下文

## 9.4 system prompt 每次运行动态重建

因为下面这些内容都是运行时动态变化的：

- 当前 memory
- 当前 skills
- channel / user 列表
- sandbox 模式
- 事件说明

所以 `system prompt` 不应只在 runner 创建时初始化一次，而应在每次 run 前刷新。

## 9.5 工具输出分为主消息和线程消息

推荐语义：

- 主消息：只展示工具标签和最终答复
- 线程：记录工具参数、结果、错误、usage

这样能保留 `mom` 的可读性，同时不丢调试能力。

## 9.6 先固定 OpenAI，不引入 auth 子系统

当前不复现：

- `/login`
- `AuthStorage`
- `auth.json`
- 多 provider model registry

当前 `mom` 只需：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（可选）
- `loadAgentConfig()` 或显式 CLI 配置

## 10. 分阶段实施计划

## 10.1 里程碑一：打通最小 Slack 闭环

### 目标

让 `mom` 能在 Slack 中响应 DM / `@mention`，并把消息持续写入 channel 工作区。

### 实现内容

- 新建 `package/mom`
- `main.ts`
- `slack.ts`
- `store.ts`
- `agent.ts`
- `context.ts`
- `log.ts`
- 启动参数：
  - `mom <working-directory>`
- 环境变量：
  - `MOM_SLACK_APP_TOKEN`
  - `MOM_SLACK_BOT_TOKEN`
  - `OPENAI_API_KEY`
- 每 channel 独立目录
- `log.jsonl`
- `context.jsonl`
- `syncLogToContext()`
- 使用 `AgentSession` 跑 OpenAI
- 主消息回复

### 验收标准

- 可以在 DM 中给 `mom` 发消息并收到答复
- channel / DM 会创建各自目录
- `log.jsonl` 与 `context.jsonl` 都会落盘
- 第二次对话能看到第一次上下文

## 10.2 里程碑二：补齐 sandbox 与 mom 专用工具

### 目标

让 `mom` 从“会聊天”进化为“会在隔离环境里做事”。

### 实现内容

- `sandbox.ts`
- 支持：
  - `--sandbox=host`
  - `--sandbox=docker:<name>`
- mom 专用工具：
  - `read`
  - `write`
  - `edit`
  - `bash`
  - `attach`
- 工具统一加 `label`
- Slack 线程工具日志
- stop / abort
- Slack 文件上传
- Slack 附件下载
- 图片附件进入模型输入

### 验收标准

- `mom` 可以在 docker sandbox 里执行 `bash`
- Slack 上传的图片或文件会被落到 `attachments/`
- `attach` 能把 bot 生成的文件回传到 Slack
- `stop` 可以中断长任务
- 工具详情写入线程，不污染主消息

## 10.3 里程碑三：补齐 memory、skills、backfill

### 目标

让 `mom` 具备持续工作的工作记忆与可复用技能体系。

### 实现内容

- workspace / channel `MEMORY.md` 读取
- workspace / channel `skills` 扫描
- `SKILL.md` 摘要注入 system prompt
- `SYSTEM.md` 更新约定
- 启动时 backfill 已交互过的 channel
- channel / user 列表注入 prompt

### 验收标准

- `mom` 能读到 workspace 与 channel memory
- `mom` 能发现并使用 `skills/` 里的技能
- 重启后仍可恢复既有 channel 历史
- 老消息会在启动后自动补进 `log.jsonl`
- 离线期间遗漏的 DM / 有效 `@mention` 会在重启后自动补处理，而不只是等待下一次触发

## 10.4 里程碑四：补齐事件系统与收尾能力

### 目标

让 `mom` 具备定时唤醒与长期自动化能力。

### 实现内容

- `events.ts`
- `events/` watcher
- `immediate`
- `one-shot`
- `periodic`
- `[SILENT]`
- queue 上限控制
- usage summary thread
- 细化日志

### 验收标准

- 往 `events/` 写入 JSON 文件能触发 `mom`
- 周期性事件能重复调度
- 没有可报告内容时，`[SILENT]` 能删除状态消息
- 每个 channel 最多排队 5 个事件

## 11. 文件级 Todo

## 11.1 `src/main.ts`

- [x] 解析 CLI 参数
- [x] 校验 `MOM_SLACK_APP_TOKEN`
- [x] 校验 `MOM_SLACK_BOT_TOKEN`
- [x] 读取 OpenAI 配置
- [x] 初始化 shared `ChannelStore`
- [x] 初始化 `SlackBot`
- [x] 初始化 `EventsWatcher`
- [x] 管理 `channelId -> ChannelState`
- [x] 实现 stop 命令处理

## 11.2 `src/slack.ts`

- [x] 建立 Socket Mode 连接
- [x] 建立 Web API client
- [x] 拉取 users / channels
- [x] 启动时 backfill
- [x] 监听 `app_mention`
- [x] 监听 `message.im`
- [x] 记录普通消息到 `log.jsonl`
- [x] 提供 `post/update/delete/upload`
- [x] 实现 per-channel queue

## 11.3 `src/store.ts`

- [x] channel 目录创建
- [x] `log.jsonl` 追加写入
- [x] 附件元数据登记
- [x] Slack 文件后台下载
- [x] 防重复日志写入

## 11.4 `src/context.ts`

- [x] 读取 `log.jsonl`
- [x] 识别 `context.jsonl` 已存在内容
- [x] 把未同步用户消息 append 到 `context.jsonl`
- [x] 处理当前消息排除逻辑
- [x] 管理 workspace `settings.json`

## 11.5 `src/sandbox.ts`

- [x] `host` executor
- [x] `docker` executor
- [x] sandbox 参数解析
- [x] container 存活校验
- [x] host / container 路径翻译
- [x] 支持 `AbortSignal`
- [x] 支持 timeout

## 11.6 `src/agent.ts`

- [x] 构建 mom system prompt
- [x] 加载 memory
- [x] 加载 skills
- [x] 创建 / 缓存 per-channel runner
- [x] 打通 `AgentSession`
- [x] 运行前 refresh prompt
- [x] 处理附件注入
- [x] 处理 tool 事件 -> Slack 线程
- [x] 处理 `[SILENT]`
- [x] 处理 usage summary

## 11.7 `src/events.ts`

- [x] 监听 `events/`
- [x] 解析 event schema
- [x] immediate 调度
- [x] one-shot 调度
- [x] periodic 调度
- [x] synthetic SlackEvent 入队
- [x] 队列满时丢弃策略

## 11.8 `src/tools/*`

- [x] `read`：文本 / 图片 / offset / limit / 截断提示
- [x] `write`：mkdir + write
- [x] `edit`：精确替换 + diff details
- [x] `bash`：stdout/stderr 合并、截断、临时文件、timeout
- [x] `attach`：Slack upload
- [x] 所有工具加 `label`
- [x] 所有工具支持 `AbortSignal`

## 12. 测试与验收

## 12.1 单测重点

- `syncLogToContext()`
- `log.jsonl` 去重与追加写入
- 附件文件名生成与下载队列
- sandbox 路径翻译
- tool truncation 行为
- event parser / scheduler
- channel queue 顺序性

## 12.2 集成测试重点

- 模拟 SlackEvent 触发单次 run
- 连续消息进入同一 channel 时的 busy / queue 语义
- Docker sandbox 中工具调用闭环
- 附件上传下载闭环
- `MEMORY.md` / `skills` 注入 system prompt
- `events/` 唤醒闭环

## 12.3 手工 smoke 场景

- DM `mom` 后可收到回复
- 在 channel `@mom` 后可收到回复
- 给 `mom` 上传图片并要求分析
- 让 `mom` 生成文件并 attach 回 Slack
- 让 `mom` 在 docker sandbox 内安装工具并持续使用
- 写入一个 one-shot event，确认到时触发
- 写入一个 periodic event，确认后续重复触发
- 运行中发送 `stop`，确认任务中断

## 12.4 验收标准

- `mom` 能作为长期进程连接 Slack，并处理 DM / `@mention`
- 每个 channel 具有独立工作区、历史、memory、skills、附件目录
- `log.jsonl` 与 `context.jsonl` 分层清晰，且能自动同步
- `mom` 能在 host / docker sandbox 中执行工具
- `attach`、附件下载、图片输入、线程工具日志全部可用
- 事件系统可用，支持 `immediate` / `one-shot` / `periodic`
- 复用现有 `@mypi/agent` / `@mypi/coding-agent`，而不是重新实现它们

## 13. 当前非目标

- `Anthropic`
- `/login`
- `auth.json`
- provider registry 重构
- Web 版 `mom`
- 把 `mom` 做成 `coding-agent` 的一个子命令或 TUI mode
- 多工作区权限隔离系统
- 复杂 RBAC / 审批流

## 14. 一句话总结

`mom` 在 `mypi` 中应作为一个独立的上层产品包来实现：底层复用现有 `OpenAI + Agent + AgentSession + SessionManager + auto-compaction`，上层新增 Slack、per-channel workspace、sandbox、attachments、memory、skills、events 和线程化输出，从而把当前 CLI 型 `coding-agent` 扩展成一个可长期运行的 Slack coding assistant。

## 15. 实施记录

### 2026-03-28

已完成第一批最小骨架落地：

- 新建 `package/mom`
- 新建 `package/mom/src/main.ts`
- 新建 `package/mom/src/slack.ts`
- 新建 `package/mom/src/store.ts`
- 新建 `package/mom/src/context.ts`
- 新建 `package/mom/src/agent.ts`
- 新建 `package/mom/src/log.ts`
- 新建 `package/mom/src/index.ts`
- 新建 `package/mom/package.json` 与 `tsconfig*`
- 已接入 Slack Socket Mode / Web API
- 已支持 DM / `@mention`
- 已支持 per-channel queue 与 `stop`
- 已支持 `log.jsonl` 记录
- 已支持 `context.jsonl` 同步未见用户消息
- 已打通 `AgentSession` 最小闭环
- 已支持 workspace / channel `MEMORY.md` 注入 system prompt

本轮尚未实现：

- backfill
- attachments 输入链路与后台下载
- thread tool logs
- skills
- events
- usage summary

验证结果：

- `npm install` 已完成
- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

### 2026-03-28（第二批）

已继续完成：

- 新建 `package/mom/src/sandbox.ts`
- 新建 `package/mom/src/tools/index.ts`
- 新建 `package/mom/src/tools/truncate.ts`
- 新建 `package/mom/src/tools/read.ts`
- 新建 `package/mom/src/tools/write.ts`
- 新建 `package/mom/src/tools/edit.ts`
- 新建 `package/mom/src/tools/bash.ts`
- 新建 `package/mom/src/tools/attach.ts`
- `main.ts` 已支持 `--sandbox=host|docker:<name>`
- `main.ts` 已接入 sandbox 校验
- `agent.ts` 已切换到 mom 专用工具层
- `slack.ts` 已支持 `uploadFile`
- 已支持 `attach` 把文件回传到 Slack
- 已支持 host / docker executor
- 已支持 docker `/workspace` 到 host 工作区路径映射
- `read` 已支持图片读取结果进入模型工具结果

本轮后仍未实现：

- Slack 附件输入下载链路
- tool 线程日志
- skills
- backfill
- events
- usage summary

### 2026-03-28（第三批）

已继续完成：

- `slack.ts` 已改为在同一 channel 运行中接收 follow-up 消息，而不是直接 busy 拒绝
- `main.ts` 已新增运行中 follow-up 分发逻辑
- `main.ts` 已串行化同一 channel 的 follow-up 入队顺序
- `agent.ts` 已接入 `Agent.followUp()`
- `agent.ts` 已显式使用 `one-at-a-time` follow-up 模式
- 同一 DM / 频道窗口里，消息 2、3 现在会按顺序进入同一次 runner 生命周期处理
- 每条 follow-up 仍会各自生成一条 Slack 回复，并写入对应 channel 的 `log.jsonl`
- 若消息到达时本轮 run 已结束，则会回退为该 channel 的下一次普通 run

本轮后仍未实现：

- tool 线程日志
- skills
- backfill
- events
- usage summary

### 2026-03-28（第四批）

已继续完成：

- `store.ts` 已支持 Slack 附件元数据登记
- `store.ts` 已支持附件后台下载与下载完成等待
- `store.ts` 已支持把相对附件路径解析为 host 本地路径
- `slack.ts` 已支持接收 Slack `files` 字段
- `slack.ts` 已支持“只有附件没有文本”的消息进入链路
- `slack.ts` 已把附件信息写入 `log.jsonl`
- `main.ts` 已向 runner 暴露 `resolveAttachments()`
- `agent.ts` 已在当前消息 prompt 中注入附件
- `agent.ts` 已在 follow-up 消息中顺序注入附件
- 图片附件现在会作为 image content 进入模型输入
- 非图片附件现在会把本地相对路径写入 `<slack_attachments>` 区块
- `context.ts` 已支持把 `log.jsonl` 中的附件同步进 `context.jsonl`
- 重新运行时，历史图片附件会继续以 image content 进入 session 上下文
- 已支持附件落地目录：`<channel>/attachments/`

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- skills
- backfill
- events
- usage summary

### 2026-03-28（第五批）

已继续完成：

- `slack.ts` 已支持给主回复消息创建 thread 消息
- `main.ts` 已向 runner 暴露 `postThreadMessage()`
- `agent.ts` 已接入 tool start / end 事件到 Slack thread
- 每个工具开始执行时会在当前主回复下发一条 thread 消息
- 每个工具结束执行时会在同一 thread 下发结果消息
- thread 消息已包含 tool name、label、参数、结果、成功/失败状态、耗时
- tool 线程日志已按当前消息上下文绑定，不同 follow-up 的 thread 不会混在一起
- 已对 thread 中的参数与结果做更激进的截断，按字符数和行数双重限制，并显示 `[truncated for Slack thread]`

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- `[SILENT]`
- 防重复日志写入
- workspace `settings.json`

### 2026-03-28（第六批）

已继续完成：

- 新建 `package/mom/src/events.ts`
- 新建 `package/mom/src/skills.ts`
- `package/mom/package.json` 已新增 `croner`
- `main.ts` 已在 Slack 连接后启动 `EventsWatcher`
- `main.ts` 已为 synthetic event 写入 `log.jsonl`
- `slack.ts` 已支持启动时按现有 `log.jsonl` 做增量 backfill
- `slack.ts` 已支持把 event 作为 synthetic SlackEvent 入队，并限制每 channel 最多排队 5 个事件
- `agent.ts` 已支持扫描 workspace / channel `skills/`
- `agent.ts` 已把 skills 摘要注入 mom system prompt
- `agent.ts` 已把 events 使用说明注入 mom system prompt
- `agent.ts` 已在每次最终回复对应的 thread 下追加 usage summary
- usage summary 已包含 input/output/cache tokens、total tokens、cost、context usage 摘要

验证结果：

- `npm install --workspace @mypi/mom croner@^9.1.0` 已完成
- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- `[SILENT]`
- 防重复日志写入
- workspace `settings.json`

### 2026-03-28（第七批）

已继续完成：

- `agent.ts` 已支持在 runner 创建前校验 `context.jsonl` 是否是合法 session JSONL
- `agent.ts` 已支持自动修复旧的 pretty-printed `context.jsonl` 为一行一个 JSON entry 的 JSONL 格式
- 修复时会先备份原文件，再重写为可被 `SessionManager.open()` 正确读取的格式
- 若 `context.jsonl` 无法修复，`agent.ts` 现在会自动备份并重建最小合法 session 文件
- 重建后可继续依赖 `log.jsonl -> context.jsonl` 同步恢复用户上下文
- `agent.ts` 已在 runner 创建失败时清理 rejected runner cache，避免后续一直命中坏的 promise
- `slack.ts` 的 channel queue 已补上未捕获异常保护，避免单次队列任务异常直接打死整个进程
- 已对真实坏掉的 `context.jsonl` 执行恢复验证，修复后可成功创建 runner

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 已用实际损坏文件验证：`/home/gao-wsl/mypi/.mom-data/D0AMY87N7LN/context.jsonl` 已成功从 pretty-printed 旧格式修复为合法 JSONL
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- `[SILENT]`
- 防重复日志写入
- workspace `settings.json`

### 2026-03-28（第八批）

已继续完成：

- `slack.ts` 已把 backfill 从“只补历史”升级为“补历史 + 自动补处理离线期间的有效 trigger”
- 离线期间新增的 DM 现在会在重启后自动排回 channel queue 执行
- 离线期间新增的有效 `@mention` 现在会在重启后自动排回 channel queue 执行
- 普通频道聊天消息仍只会补进 `log.jsonl`，不会自动触发 run
- 单独只有 mention、没有正文且没有附件的消息，仍不会作为有效 trigger 自动补处理
- `stop` 离线消息不会在重启后重放
- 自动补处理按 channel queue 顺序执行，同一 channel 的离线消息会按时间顺序逐条回复

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- `[SILENT]`
- 防重复日志写入
- workspace `settings.json`

### 2026-03-28（第九批）

已继续完成：

- `store.ts` 已新增按 Slack `ts` 的 `log.jsonl` 去重缓存
- 相同 `channel + ts` 的消息现在不会再被重复追加写入 `log.jsonl`
- `slack.ts` 已新增运行时 trigger 去重，避免同一条 Slack 消息被 live event 与 replay event 各处理一次
- 去重 key 采用 `channelId:ts`
- backfill replay 时也会先登记 trigger，防止随后到达的实时事件再次触发同一条消息
- 这次修复覆盖了“重启后 replay + Socket Mode 实时事件重叠”造成的双回复问题

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- `[SILENT]`
- workspace `settings.json`

### 2026-03-28（第十批）

已继续完成：

- `slack.ts` 已把启动期 live 消息处理改为“先缓冲，等 replay backlog 跑完后再处理”
- 启动后如果存在离线 replay backlog，新的 live DM / mention / 普通频道消息会先 ack 并暂存在内存缓冲队列中
- backlog replay 完成前，不再让新的 live 消息提前写入 `log.jsonl` 或插队执行
- replay backlog 完成后，缓冲中的 live 消息会按到达顺序依次恢复处理
- `slack.ts` 已为 replay backlog 增加每 channel 的临时状态消息：`_Replaying N offline messages..._`
- replay 状态消息会在该 channel backlog 跑完后自动删除，避免长期污染频道尾部
- `ChannelQueue` 已新增 `onIdle()`，用于等待某个 channel 的 replay queue 真正排空后再解除启动期缓冲

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后仍未实现：

- `[SILENT]`
- workspace `settings.json`

### 2026-03-28（第十一批）

已继续完成：

- 在 workspace 级 `skills/` 下新增了示例 skill：`weather-curl`
- skill 路径：`/home/gao-wsl/mypi/.mom-data/skills/weather-curl/`
- 新增 `SKILL.md`，明确告诉 mom：天气问题优先使用 `curl` 查询 `wttr.in`，不要直接回答“无法联网”
- 新增 `weather.sh`，支持：
  - `bash ./skills/weather-curl/weather.sh Hangzhou current`
  - `bash ./skills/weather-curl/weather.sh Hangzhou tomorrow`
- `weather.sh` 已支持中文别名 `杭州 -> Hangzhou`
- 已验证脚本可直接从当前 workspace 根目录执行，并能返回当前天气与明天天气摘要
- 因为 `agent.ts` 每次 run 前都会重新扫描 workspace / channel skills，所以该 skill 无需改动代码、下一次对话即可被 mom 发现

验证结果：

- `bash ./skills/weather-curl/weather.sh Hangzhou current` 通过
- `bash ./skills/weather-curl/weather.sh Hangzhou tomorrow` 通过
- `bash ./skills/weather-curl/weather.sh 杭州 tomorrow` 通过

本轮后仍未实现：

- `[SILENT]`
- workspace `settings.json`

### 2026-03-28（第十二批）

已继续完成：

- 已将 workspace skill `weather-curl` 从“脚本 + 说明”简化为“纯说明型 skill”
- 已重写 `SKILL.md`，不再引导 mom 依赖 `weather.sh`
- `SKILL.md` 现在只描述：遇到天气问题时，直接通过 `bash` + `curl wttr.in` 查询，然后再总结结果
- 已删除 `weather.sh`，用于更干净地验证“只靠 skill 描述，mom 是否也会自己使用 curl”
- 因为 `agent.ts` 每次 run 前都会重新扫描 skills，所以这次改动无需重启代码即可在下一轮对话生效

验证结果：

- `weather-curl` 目录下当前仅保留 `SKILL.md`
- skill 现在只提供两类推荐命令：
  - `curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=3'`
  - `curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=j1'`

本轮后仍未实现：

- `[SILENT]`
- workspace `settings.json`

### 2026-03-28（第十三批）

已继续完成：

- `agent.ts` 已支持 `[SILENT]` 语义
- 当最终回复为 `[SILENT]` 时，mom 现在会删除 `_Thinking..._` 主消息
- 当前 reply 对应 thread 中已发出的工具日志现在也会在 `[SILENT]` 时被回收删除
- `[SILENT]` reply 不再追加 usage summary，也不会把 `[SILENT]` 文本写进 `log.jsonl`
- `agent.ts` 的 system prompt 已补充 `[SILENT]` 使用说明，明确适用于 periodic / background checks 无事可报场景
- `context.ts` 已新增 workspace `settings.json` 读取与解析能力
- 当前支持从 `<workingDir>/settings.json` 读取：
  - `openai.model`
  - `openai.baseUrl`
  - `agent.thinkingLevel`
  - `agent.systemPromptAppend`
  - `agent.compaction.*`
- `main.ts` 已把 workspace `settings.json` 合并到 mom 的有效运行配置中
- 当 workspace `settings.json` 发生变化时，新的 run 会基于更新后的有效配置重建 channel runner
- 这意味着 workspace 级 model / thinking / compaction / prompt append 现在可以不改代码、直接通过 `settings.json` 驱动
- 已为这两块能力新增定向测试：`package/mom/test/settings-and-silent.test.ts`

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npx tsx ../../node_modules/vitest/dist/cli.js --run --root ../.. package/mom/test/settings-and-silent.test.ts` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run typecheck` 仍被既有 `package/coding-agent/test/*` 的历史类型错误阻塞，与本轮 `mom` 改动无关

本轮后主要待办：

- 当前计划内大块能力已基本收尾，后续以体验优化和新增产品需求为主

### 2026-03-29（第十四批）

已继续完成：

- `mom` 已新增 `clear` 控制命令
- 当前在 DM 或 `@mention` 窗口中输入 `clear`，会清空该 channel 的会话上下文
- `clear` 当前语义是：删除该 channel 的 `log.jsonl` 与 `context.jsonl`
- `clear` 不会删除 channel 的 `MEMORY.md`、`skills/` 或 workspace 级文件
- `clear` 会在清空后同时重置 `ChannelStore` 内部的 `ts` 去重缓存，避免删除日志后仍命中旧缓存
- `clear` 还会 dispose 并移除当前 channel 的 runner cache，保证下一条消息会新建干净 runner
- 当前如果该 channel 正在运行，`clear` 会拒绝执行并提示先发送 `stop`
- `mom` 仍然没有手动 `compact` 命令；压缩上下文仍通过既有 auto-compaction 机制自动执行
- 已新增定向测试：`package/mom/test/clear.test.ts`

验证结果：

- `npm run build --workspace @mypi/mom` 通过
- `npx tsx ../../node_modules/vitest/dist/cli.js --run --root ../.. package/mom/test/clear.test.ts` 通过
- `npm run typecheck --workspace @mypi/mom` 通过
- 根级 `npm run check` 仍不存在
