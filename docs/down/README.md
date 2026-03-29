# mypi 分层说明（面试版）

本文档组是给“第一次看这个项目的人”准备的，不是规划文档，也不是单一模块的开发笔记。

目标是让读者看完后，能快速回答下面几个问题：

- 这个项目整体是怎么分层的？
- 每一层主要负责什么？
- 每一层对外暴露了什么能力？
- 几层之间是怎么衔接起来的？
- 为什么 `coding-agent` 这一层是项目中最关键的一层？
- `mom` 是怎么在现有 `ai / agent / coding-agent` 之上再包装成 Slack 长驻产品的？

---

## 0. 快速入口

如果只是想先把项目跑起来，建议先看两份文档开头的“快速启动”：

- `coding-agent`：见 [coding-agent.md](./coding-agent.md)
- `mom`：见 [mom.md](./mom.md)

其中：

- 本地 coding-agent 主入口是 `node package/coding-agent/dist/cli/main.js`
- Slack mom 主入口是 `node package/mom/dist/main.js`
- 如果想把 `mypi` 变成 shell 命令，见 `coding-agent.md` 开头的“如何让 shell 里的 `mypi` 直接启动 coding-agent”

`ai.md` 和 `agent.md` 开头也补了最小使用示例，便于快速理解这两层的实际调用方式。

---

## 1. 阅读顺序

建议按下面顺序阅读：

1. [ai.md](./ai.md)
2. [agent.md](./agent.md)
3. [coding-agent.md](./coding-agent.md)
4. [mom.md](./mom.md)
5. [pi-tui.md](./pi-tui.md)

这是一个典型的“自底向上”结构：

- `ai`：模型调用协议层
- `agent`：单 Agent 编排层
- `coding-agent`：产品核心层，负责 session / tools / CLI / TUI 装配
- `mom`：Slack 长驻运行时，在 `coding-agent` 之上增加 transport、workspace、events、skills、memory、backfill 等
- `pi-tui`：复用的终端 UI 框架，不是这个项目的业务核心

---

## 2. 一张图看整体架构

```text
Slack / CLI / TUI
      |
      v
+-------------------+
|       mom         |  Slack transport / per-channel runtime / events / memory / skills
+-------------------+
          |
          v
+-------------------+
|   coding-agent    |  sessions / workspace tools / config / CLI / TUI / compaction
+-------------------+
          |
          v
+-------------------+
|       agent       |  single-agent turn loop / tool orchestration / steer & followUp
+-------------------+
          |
          v
+-------------------+
|         ai        |  model registry / provider adapter / unified streaming protocol
+-------------------+
          |
          v
     OpenAI API / Anthropic Messages API
```

如果不用 Slack，而只跑本地 CLI/TUI，那么入口就会直接落在 `coding-agent`。

如果用 Slack 长驻机器人，那么入口是 `mom`，但它底下仍然复用 `coding-agent -> agent -> ai` 这条主链路。

---

## 3. 这几个包分别是什么

### `@mypi/ai`
负责：

- 模型元数据
- provider 注册
- 统一流式事件协议
- `stream / complete / streamSimple / completeSimple`

这一层只解决：

> “如何稳定地把上下文发给模型，并把模型回复变成统一事件流。”

它不关心：

- session
- branch
- workspace tools
- Slack
- TUI

---

### `@mypi/agent`
负责：

- 单 Agent turn loop
- tool call 检测与执行
- `steer / followUp`
- agent 级事件流

这一层解决的是：

> “模型说要调工具时，如何执行工具、把结果喂回模型，并持续运行到一轮真正结束。”

它仍然不关心：

- 会话持久化
- 分支树
- CLI/TUI
- Slack transport

---

### `@mypi/coding-agent`
这是项目最核心的一层。

负责：

- session 持久化
- session tree / branch / fork / navigate
- workspace tools（`read/write/edit/bash`）
- auto-compaction
- branch summary / compaction summary
- config 解析
- CLI 与 TUI 装配

这层把 `ai + agent + tools + session + UI` 组合成“一个真的能用的 coding-agent 产品骨架”。

如果面试时只让我重点讲一层，我会优先讲这一层。

---

### `@mypi/mom`
负责：

- Slack Socket Mode / Web API 接入
- per-channel runner
- `log.jsonl` / `context.jsonl`
- channel memory / workspace skills / events
- attachments 输入输出
- backfill / offline replay
- tool thread logs / usage summary / `[SILENT]`

这层不是重写 agent，而是：

> “把已有 coding-agent core 包装成一个可长期运行、可恢复、可接 Slack 的产品。”

---

### `@mariozechner/pi-tui`
这是复用的终端 UI 框架。

在本项目里的定位是：

- 为 `coding-agent` 的交互模式提供终端 UI 能力
- 提供 `TUI / Editor / Text / SelectList / Overlay` 等现成组件

它不是 `mypi` 自己的业务核心，所以本文档只做简要说明。

---

## 4. 两条最重要的运行链路

### 链路 A：本地 CLI/TUI 使用 `mypi`

```text
用户输入 prompt
  -> coding-agent CLI / InteractiveApp
  -> AgentSession
  -> SessionRuntime
  -> Agent
  -> ai.streamSimple(...)
  -> 模型输出 / tool call / tool result
  -> SessionRuntime 持久化到 session file
  -> CLI/TUI 展示结果
```

### 链路 B：Slack 中使用 `mom`

```text
Slack DM / @mention / periodic event
  -> SlackBot
  -> channel queue
  -> AgentRunner
  -> AgentSession
  -> Agent
  -> ai.streamSimple(...)
  -> 工具执行 / session 更新
  -> Slack 主消息 + thread 日志
  -> log.jsonl / context.jsonl / attachments 持久化
```

---

## 5. 面试时可以先讲什么

如果需要 1 分钟快速介绍这个项目，可以这样讲：

> `mypi` 是一个分层很清楚的 coding-agent 项目。最底层是 `ai`，负责统一模型调用；上面是 `agent`，负责单 Agent 的 turn loop 和工具编排；再上面是 `coding-agent`，负责 session tree、branch、workspace tools、CLI/TUI 和 auto-compaction，这层是产品核心；`mom` 则是在这套 core 之上加了 Slack transport、per-channel workspace、memory、skills、events、attachments 和离线恢复，把它变成一个可长期运行的 Slack coding assistant。

---

## 6. 相关文档

如果想看更偏实现过程和演进记录，可继续看：

- `docs/architecture/ai.md`
- `docs/impl/ai.md`
- `docs/Mom/mom1.md` ~ `mom11.md`
- `docs/plan/*.md`

这些文档更偏“开发过程 / 规划 / 某轮实现细节”。

而 `docs/down/` 这组文档更偏：

> “站在现在这个代码状态上，给别人讲清楚这个项目已经是什么样。”
