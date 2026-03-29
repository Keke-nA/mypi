# Mom 层说明

对应代码：

- `package/mom/src`
- 包名：`@mypi/mom`
- CLI：`mom`

---

## 0. 快速启动

以下命令都假设你当前就在仓库根目录：

```bash
cd ~/mypi
```

### 先构建

首次运行，或者改过代码后，先构建：

```bash
npm run build --workspace @mypi/mom
```

### 启动前需要的环境变量

最少需要：

```bash
export MOM_SLACK_APP_TOKEN=...
export MOM_SLACK_BOT_TOKEN=...
```

模型 provider 相关配置有两种来源：

1. 从 `~/.mypi/agent/config.json` 读取
2. 直接用环境变量覆盖

如果你已经在 `~/.mypi/agent/config.json` 里配置了 provider / apiKey / baseUrl / model，那么启动 `mom` 时通常不需要再额外 export `OPENAI_*` 或 `ANTHROPIC_*`。

例如，一个 Kimi Anthropic-compatible 的最小配置可以是：

```json
{
  "anthropic": {
    "apiKey": "<your-key>",
    "baseUrl": "https://api.kimi.com/coding/",
    "model": "kimi-k2.5"
  },
  "agent": {
    "provider": "anthropic"
  }
}
```

只有在你想临时覆盖全局配置时，才需要额外 export，例如：

```bash
export ANTHROPIC_API_KEY=...
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_MODEL=kimi-k2.5
```

### 用 `node` 直接启动 mom

#### host 模式

```bash
node package/mom/dist/main.js --sandbox=host ~/mypi/.mom-data
```

#### docker 模式

```bash
node package/mom/dist/main.js --sandbox=docker:mypi-box ~/mypi/.mom-data
```

其中 docker 模式要求：

- 容器已经存在
- 容器处于 running 状态
- host 的 `~/mypi/.mom-data` 已挂载到容器内 `/workspace`

一个最小可用示例是：

```bash
docker run -dit \
  --name mypi-box \
  -v /home/gao-wsl/mypi/.mom-data:/workspace \
  ubuntu:24.04 \
  sleep infinity
```

### 启动语义

当前 `mom` 是：

- **主进程跑在 WSL/host 上**
- Slack 连接、backfill、events watcher 都跑在 host 上
- 只有 `read/write/edit/bash` 这类工具执行会切到 sandbox

也就是说：

- `--sandbox=host` 时，工具直接在宿主机工作区执行
- `--sandbox=docker:mypi-box` 时，工具会被 mom 转成 `docker exec -w /workspace mypi-box sh -c '...'`

### 当前 Slack 控制命令

当前内建的轻量控制命令有：

- `stop`
  - 中断当前 channel 正在运行的任务
- `clear`
  - 在当前 channel 空闲时，清空该 channel 的 `log.jsonl` 与 `context.jsonl`
  - 用于“把这个 DM / 频道窗口的上文清空，重新开始”
  - 当前不会手动暴露 `compact` 命令；`compact` 仍按现有 auto-compaction 逻辑自动发生

`mom` 不是另一个独立的 agent core，而是建立在 `@mypi/coding-agent` 之上的产品层。

一句话定位：

> `mom` 是一个 Slack 长驻 coding assistant runtime，它把 `coding-agent` 包装成按频道隔离、可长期运行、可恢复、可调度的工作助手。

---

## 1. 这一层主要负责什么

`mom` 主要补的是 `coding-agent` 没有的“长期运行产品能力”：

- Slack transport
- per-channel workspace / runner / queue
- `log.jsonl` / `context.jsonl`
- sandbox 执行
- attachments 输入输出
- MEMORY / skills / events
- startup backfill
- offline replay
- tool thread logs
- usage summary
- `[SILENT]`
- workspace `settings.json`

所以它不是在重写 `Agent`，而是在加：

```text
transport + orchestration + persistence + recovery + product semantics
```

---

## 2. 这一层对外提供什么

### 最重要的入口

- CLI：`mom`
- 入口文件：`package/mom/src/main.ts`

### 对外导出的模块

`package/mom/src/index.ts` 当前导出：

- `agent`
- `context`
- `events`
- `log`
- `sandbox`
- `skills`
- `slack`
- `store`

也就是说，除了 CLI，本层还暴露了自己的核心子系统，便于后续扩展或测试。

---

## 3. 它和 coding-agent 的关系是什么

这是最值得讲清楚的一点。

### `coding-agent` 已经有

- `AgentSession`
- `SessionRuntime`
- `SessionManager`
- workspace tools
- system prompt
- auto-compaction

### `mom` 新增的是

- Slack 输入输出
- channel 级长期持久化目录
- channel 级 runner
- Slack 附件链路
- events watcher
- memory/skills 发现
- log/context 同步
- 离线恢复和 replay

所以 `mom` 的架构不是“再写一套 agent”，而是：

```text
Slack Runtime
   +
Per-channel Product Semantics
   +
Existing AgentSession Core
```

---

## 4. 核心运行模型：按 channel 隔离

当前 `mom` 的隔离粒度是：

> 一个 Slack channel / DM = 一个本地目录 = 一个 runner = 一份 `context.jsonl`

### 不是按 thread 隔离
当前不是：

- 一个 thread 一个 session

而是：

- 一个 channel / DM 一个 session

### 这意味着

- 同一频道内消息共享上下文
- 同一频道内 follow-up 会落在同一个长期 runner 上
- 不同频道之间并行
- 同一频道内串行

这非常适合“频道就是长期工作上下文”的 Slack 使用方式。

---

## 5. 工作区目录长什么样

`mom` 的 workspace 根目录大致长这样：

```text
<workingDir>/
  settings.json
  MEMORY.md
  skills/
  events/
  <channelId>/
    MEMORY.md
    log.jsonl
    context.jsonl
    attachments/
    skills/
```

### 各部分作用

- `settings.json`
  - workspace 级运行配置
- `MEMORY.md`
  - workspace 级长期记忆
- `skills/`
  - workspace 级技能
- `events/`
  - synthetic event / 定时任务定义
- `<channelId>/log.jsonl`
  - Slack 历史日志
- `<channelId>/context.jsonl`
  - 真正给 `AgentSession` 用的长期上下文
- `<channelId>/attachments/`
  - Slack 附件落地目录
- `<channelId>/MEMORY.md`
  - channel 级记忆
- `<channelId>/skills/`
  - channel 级技能，覆盖 workspace 同名技能

---

## 6. Slack 接入层是怎么工作的

代码位置：`package/mom/src/slack.ts`

### SlackBot 负责什么

`SlackBot` 负责：

- Socket Mode 接入
- Web API 调用
- 用户/频道缓存
- 事件标准化
- channel queue
- backfill
- offline replay
- trigger 去重
- replay backlog 状态提示

### 输入来源

当前支持：

- DM
- 频道 `@mention`
- synthetic event

### 不支持或未重点支持

当前未强调支持：

- MPIM
- thread 级会话隔离
- Slackbot DM 中的假 mention 语义

### 一个关键设计点

Slack 层不会自己直接处理 AI，它会把输入标准化成 `SlackEvent`，然后塞进 channel queue，再交给 `main.ts` 的 handler。

---

## 7. ChannelQueue：为什么同频道内不会乱

`slack.ts` 内部每个 channel 都有一个 `ChannelQueue`。

### 它负责

- 同一频道串行
- 不同频道并行
- backlog replay 等待队列真正 idle
- 异常兜底，避免单次错误打死整进程

这使得 `mom` 可以在单进程里维持多个长期 runner，但不把同一频道的上下文跑乱。

---

## 8. `main.ts`：真正把 Slack 和 runner 接起来

代码位置：`package/mom/src/main.ts`

`main.ts` 是整个 `mom` 的总装层。

### 它负责

- 解析 CLI 参数
- 通过 `loadAgentConfig(...)` 加载 `~/.mypi/agent/config.json` / 环境变量 / CLI 层公共配置
- 配置当前选中的 provider（OpenAI / Anthropic-compatible）
- 创建共享 `ChannelStore`
- 为每个 channel 管理 `ChannelState`
- 动态创建/复用 `AgentRunner`
- 把 SlackEvent 交给 runner
- 处理 stop / followUp / runner 重建
- 启动 `EventsWatcher`

### `ChannelState` 里有什么

- `running`
- `runner`
- `runnerPromise`
- `runnerKey`
- `stopRequested`
- `stopMessageTs`
- `followUpPromise`

除了 `stop`，`main.ts` 现在还负责 `clear`：

- 当 channel 空闲时，dispose 当前 runner
- 删除当前 channel 的 `log.jsonl` 与 `context.jsonl`
- 清空 `ChannelStore` 里的 `ts` 去重缓存
- 下一次消息到来时，再懒创建一个全新的 runner

这里的 `runnerKey` 很关键，它反映“当前 channel runner 是基于哪份有效配置创建的”。

如果 workspace `settings.json` 改了，key 会变化，下次 run 就会重建 runner。

---

## 9. `AgentRunner`：mom 层真正复用 coding-agent 的位置

代码位置：`package/mom/src/agent.ts`

### 它本质上做什么

`AgentRunner` 是 mom 对 `AgentSession` 的封装。

它做的事情包括：

- 确保 channel `context.jsonl` 合法
- 创建 `AgentSession`
- 每次 run 前同步 `log.jsonl -> context.jsonl`
- 重新构建 system prompt
- 注入 memory / skills / events / workspace prompt append
- 接入 sandbox tools
- 接入 attachments
- 监听 `AgentEvent`
- 把 tool logs / usage summary 映射到 Slack thread
- 处理 `[SILENT]`

### 当前 system prompt 会包含什么

- coding-agent 的基础 coding prompt
- Slack channel 信息
- workspace / channel 路径
- skills 目录和可用技能摘要
- events 用法说明
- `[SILENT]` 使用约定
- workspace / channel memory
- workspace `settings.json` 的 prompt append

所以 `mom` 不是把 skill 或 memory 写死进 session，而是：

> 每次 run 前动态注入运行时系统提示。

---

## 10. `log.jsonl` 和 `context.jsonl` 各干什么

### `log.jsonl`
更接近 Slack 历史日志：

- 用户消息
- bot 最终回复
- 附件元数据
- synthetic event

这是 mom 自己的“Slack 对话历史层”。

### `context.jsonl`
则是 `AgentSession` 真正消费的长期上下文文件。

这层不是直接用 `log.jsonl` 作为 session，而是通过：

- `syncLogToSessionManager(...)`

把没进入 session 的用户消息同步进去。

### 为什么分两层

因为它们负责的语义不同：

- `log.jsonl`：面向 Slack 历史与恢复
- `context.jsonl`：面向 LLM session 状态

这层设计非常合理，也很适合面试里展开讲。

---

## 11. `ChannelStore`：日志与附件存储层

代码位置：`package/mom/src/store.ts`

### 负责什么

- 创建 channel 目录
- 记录 `log.jsonl`
- 附件下载
- 附件路径解析
- 记录 bot 回复
- 按 Slack `ts` 去重

### 一个关键点

它维护了 channel 级 `loggedTimestamps`，所以同一条 Slack 消息不会反复写进 `log.jsonl`。

这和 `SlackBot` 里的 trigger 去重配合起来，解决了：

- 启动期 replay
- live event

之间可能出现的双回复问题。

---

## 12. attachments 是怎么走通的

### 输入链路

1. Slack 消息带 `files`
2. `ChannelStore.processAttachments(...)` 登记并后台下载
3. 下载到 `<channel>/attachments/`
4. `RunnerContext.resolveAttachments()` 在真正运行前拿到已落地文件
5. 图片：直接转成 `ImageContent`
6. 非图片：写进 `<slack_attachments>` 区块，让模型再用 `read` 工具读

### 输出链路

`attach` 工具会把本地文件经由 Slack `files.uploadV2` 发回频道。

### 这说明

`mom` 已经不是“只会纯文本回复”，而是有完整的附件输入/输出闭环。

---

## 13. sandbox 和 mom tools

### sandbox
代码位置：`package/mom/src/sandbox.ts`

当前支持：

- `host`
- `docker:<container>`

### mom tools
代码位置：`package/mom/src/tools/*`

当前工具：

- `read`
- `write`
- `edit`
- `bash`
- `attach`

这些工具与 `coding-agent` 自带 workspace tools 的区别在于：

- 它们适配了 sandbox
- `read` 支持图片内容
- `attach` 能上传回 Slack
- 路径语义围绕 mom workspace 设计

所以 `mom` 实际上在 `coding-agent` 工具层之上，又做了一层产品适配。

---

## 14. skills / memory / events

### memory
代码位置：`package/mom/src/agent.ts`

当前支持：

- workspace `MEMORY.md`
- channel `MEMORY.md`

行为是：

- run 前读取
- 注入 system prompt

### skills
代码位置：`package/mom/src/skills.ts`

当前支持：

- workspace `skills/`
- channel `skills/`
- `SKILL.md` + frontmatter

特点：

- channel 同名 skill 覆盖 workspace skill
- skills 是 prompt-injected，不是注册成独立 tool

### events
代码位置：`package/mom/src/events.ts`

当前支持：

- `immediate`
- `one-shot`
- `periodic`

原理是：

- 监听 `events/` 目录
- `one-shot` 用 `setTimeout`
- `periodic` 用 `Cron`
- 到点后构造 synthetic `SlackEvent`
- 再塞回现有 channel queue

因此 event 任务不是另一套 agent 系统，而是走和普通 Slack 消息同一条链路。

---

## 15. `[SILENT]` 是什么

这是 `mom` 的一个产品语义。

如果 periodic / background check 没有任何值得报告的内容，模型可以只回复：

```text
[SILENT]
```

此时 `mom` 会：

- 删除 `_Thinking..._`
- 删除这次 reply 已发出的 thread 日志
- 不发送最终主消息
- 不追加 usage summary
- 不把 `[SILENT]` 写进 `log.jsonl`

所以从 Slack 视角看，这轮像是“静默完成”。

这对于长期运行的定时任务非常关键，否则频道会被大量“没事发生”的消息刷屏。

---

## 16. tool thread logs 和 usage summary

`mom` 采用的是：

- 主消息简洁
- 细节挂 thread

### thread 里会放什么

- tool start
- tool end
- 参数
- 结果
- 错误
- 耗时
- usage summary

### 还做了什么保护

- 双重截断（字符数 + 行数）
- ` ``` ` 替换，避免 code block 被打坏
- 结果过长时显示 `[truncated for Slack thread]`

所以当前这套设计兼顾了：

- 可观测性
- Slack 可读性
- 输出泄露控制

---

## 17. backfill / replay / 去重

这是 `mom` 区别于普通 bot 的另一块核心能力。

### startup backfill
启动时会：

- 扫已有 channel
- 把离线期间新增消息 backfill 到 `log.jsonl`

### offline trigger replay
对于离线期间收到的：

- DM
- 有效 `@mention`

启动后不仅会补历史，还会：

- 自动 replay
- 自动排回 queue
- 自动补回复

### 启动期体验优化
在 replay backlog 期间：

- 先发 `_Replaying N offline messages..._`
- live 消息先缓冲
- backlog 跑完后再恢复 live 流量

### 去重策略
- `log.jsonl` 按 Slack `ts` 去重
- trigger 按 `channelId:ts` 去重

这解决了 replay 与 live event 重叠导致的双回复问题。

---

## 18. workspace `settings.json`

代码位置：`package/mom/src/context.ts`

当前支持从 `<workingDir>/settings.json` 读取：

- `openai.model`
- `openai.baseUrl`
- `anthropic.model`
- `anthropic.baseUrl`
- `agent.provider`
- `agent.thinkingLevel`
- `agent.systemPromptAppend`
- `agent.compaction`

然后在 `main.ts` 里把它与 base config 合并。

### 生效方式
不是只在启动时读一次，而是：

- 每次新 run 前重新读取
- 如果有效配置发生变化
- 就重建该 channel 的 runner

而且现在 runner 重建后，不要求必须 `clear` 才能继续聊天：

- 现有 `context.jsonl` 会先被恢复
- 如果持久化 session 里的 `model / provider / thinkingLevel` 和当前有效配置不同
- `mom` 会自动追加新的 `model_change` / `thinking_level_change`
- 后续对话继续沿用原有上下文，只是切到新的模型配置

所以 `clear` 的语义现在更明确是：

> 真正清空这个 channel 的上下文重新开始。

而不是“切模型必须先 clear”。

---

## 19. 为什么说 mom 是“产品层”而不是“模型层”

因为它真正解决的是这些产品问题：

- 用户从 Slack 来
- 一个频道一个长期上下文
- 机器人可能离线再恢复
- 附件要能下载和上传
- 要能按时间调度
- 要能静默完成
- 要能保存长期记忆和技能
- 要能把调试信息放到 thread 而不是主消息

这些都不是 `ai` 或 `agent` 层会去处理的问题。

所以 `mom` 的核心价值不在“更强模型协议”，而在：

> “把已有 agent core 包装成一个真实可长期运行的 Slack 产品。”

---

## 20. 当前限制

当前代码状态下，需要明确这些边界：

- 当前主要走 OpenAI / Anthropic-compatible 路径
- channel 隔离，不是 thread 隔离
- skills 目前是 prompt-injected，不是 tool plugin system
- 未重点支持 MPIM
- 相对时间事件解析仍依赖模型自己先转成绝对时间

这些不是 bug，而是当前产品范围。

---

## 21. 面试时如果被问：怎么扩到 Discord / 飞书

这是一个很典型的架构追问。

### 最稳的回答方向

可以直接说：

> 如果要从 Slack 扩到 Discord 或飞书，我认为大部分改动会发生在 `mom` 层，而不是 `ai / agent / coding-agent` 层。因为模型调用、session、工具执行、上下文压缩这些核心能力已经和平台解耦了，真正平台相关的是 transport、附件、历史消息、reply/thread 语义和鉴权。

### 具体应该改哪里

最先要抽的是当前比较 Slack-specific 的部分：

- `SlackEvent` -> 更通用的 `ChatEvent`
- `SlackBot` -> 更通用的 `ChatTransport`
- `channelId` -> 更通用的 `conversationId` / `conversationKey`
- `postThreadMessage()` -> 更通用的 detail/reply 输出接口

这样 `main.ts` 就不再依赖 Slack，而是依赖一个通用 transport 抽象。

### 哪些能力可以继续复用

这些大体都可以继续复用：

- `AgentRunner`
- `AgentSession` / `SessionRuntime` / `SessionManager`
- `log.jsonl + context.jsonl`
- sandbox
- `read/write/edit/bash/attach`
- memory / skills / events
- `[SILENT]`
- `clear`
- auto-compaction

因为这些本质上处理的是：

- 模型怎么跑
- 上下文怎么存
- 工具怎么执行
- 会话怎么恢复

不是某一个 IM 平台独有的问题。

### 真正平台相关、要单独适配的部分

主要是这些：

- 实时消息接入
- DM / mention 判定
- 附件下载与上传
- 历史消息 backfill
- offline replay
- reply / thread / detail message 的平台映射
- token / app secret / webhook / 事件签名等鉴权配置

也就是说，Slack、Discord、飞书各自都需要一个 transport adapter。

### 如果只做最小可用版

我会建议第一阶段先只做：

- DM / mention 输入
- 主消息回复
- 附件输入输出
- per-conversation runner
- `stop`
- `clear`

先不追求一上来就完整复刻 Slack 版的：

- backfill
- offline replay
- thread 工具日志
- usage summary 细节输出

这样工程风险更小，也更容易先把产品跑起来。

### 面试里的 30 秒版本

> 如果要支持 Discord 或飞书，我不会去改 `ai` 或 `agent` 内核，而是优先把当前 `mom` 的 Slack transport 抽象成通用 chat transport。底下的 session、tools、sandbox、memory、events 基本都能复用；上面每个平台各自实现消息接入、附件、历史同步和 reply/thread 映射。先做最小可用版，再逐步补齐 backfill 和 replay 这类平台深度能力。

---

## 22. 面试时如何一句话介绍这层

> `@mypi/mom` 是一个构建在 `coding-agent` core 之上的 Slack 长驻运行时。它通过 per-channel runner、`log.jsonl + context.jsonl` 双层持久化、sandbox 工具、memory/skills/events、offline replay、thread logs 和 `[SILENT]` 语义，把本地 coding-agent 扩展成了一个可恢复、可调度、可长期运行的团队工作助手。

---

## 23. 关键代码位置

- `package/mom/src/main.ts`
- `package/mom/src/slack.ts`
- `package/mom/src/agent.ts`
- `package/mom/src/context.ts`
- `package/mom/src/events.ts`
- `package/mom/src/store.ts`
- `package/mom/src/sandbox.ts`
- `package/mom/src/skills.ts`
- `package/mom/src/tools/index.ts`
