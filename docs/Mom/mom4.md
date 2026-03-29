# Mom 进度记录（四）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的下一轮推进，覆盖四块核心能力：

- backfill
- skills
- events
- usage summary

这四块补完后，当前 `mom` 已经从“能在 Slack 里对话、跑工具、吃附件”推进到“更像一个长期存在的工作体”。

---

## 1. 这一轮解决的核心问题

在 `mom3.md` 之后，`mypi` 里的 `mom` 已经具备：

- Slack 接入
- per-channel 上下文
- follow-up 顺序处理
- sandbox
- 附件输入输出
- tool thread logs

但还缺四个很关键的长期能力：

1. 进程重启后，如何把 Slack 历史补回来
2. 如何把可复用能力沉淀为 `skills`
3. 如何让 bot 被文件事件 / 定时任务唤醒
4. 每次 run 到底花了多少 token / cost

这一轮就是把这四块补上。

---

## 2. backfill

### 2.1 当前实现

`slack.ts` 现在已经支持：

- 启动时扫描当前工作区里已存在 `log.jsonl` 的 channel
- 对这些 channel 调 Slack `conversations.history`
- 按 `log.jsonl` 里最后一个已知时间戳之后做增量拉取
- 把新补到的消息继续写入本地 `log.jsonl`
- 同时保留附件元数据并继续触发后台下载

### 2.2 当前语义

这意味着：

- bot 重启后，不会只从“现在”开始记忆
- 如果离线期间频道或 DM 又来了新消息，启动后会先补回来
- 下次真正运行前，`syncLogToSessionManager()` 还能把这些补回来的消息继续同步进 `context.jsonl`

### 2.3 当前边界

当前 backfill 是增量式的：

- 只对已经存在本地 `log.jsonl` 的 channel 做 backfill
- 不会扫所有 Slack 频道历史
- 每个 channel 会做有限页数的增量拉取，避免启动过重

这个边界是合理的，因为当前目标是恢复“mom 已经参与过的会话”，而不是做一个全量归档机器人。

---

## 3. skills

### 3.1 当前实现

新增：

- `package/mom/src/skills.ts`

它已经支持：

- 扫描 workspace 级 `skills/`
- 扫描 channel 级 `skills/`
- 读取每个 skill 目录下的 `SKILL.md`
- 解析 YAML frontmatter 中的：
  - `name`
  - `description`
- 把 skill 列表格式化后注入 mom 的 system prompt

### 3.2 当前覆盖规则

当前采用的覆盖规则是：

- workspace skill：全局可见
- channel skill：同名时覆盖 workspace skill

这和 `mom` 的工作区层级语义是对齐的。

### 3.3 当前 prompt 注入内容

`agent.ts` 现在已经把这些内容注入 prompt：

- workspace skills 目录位置
- channel skills 目录位置
- `SKILL.md` 需要的 frontmatter 结构
- 当前已发现 skill 的摘要
- skill 的目录路径和 README 路径

这意味着 bot 现在已经知道：

- skills 放哪
- skills 应该长什么样
- 当前有哪些 skills 可用

### 3.4 当前仍未做的 skill 细节

这轮完成的是：

- 发现 skills
- 注入 prompt

还没做的是更复杂的周边，例如：

- `SYSTEM.md` 配套记录
- skill 依赖安装约定增强
- 更完整的 skill 诊断输出

但作为第一版，当前已经足够让 mom 开始“看见并使用已有 skills”。

---

## 4. events

### 4.1 当前实现

新增：

- `package/mom/src/events.ts`

并且 `main.ts` 现在会在 Slack 连接后启动 `EventsWatcher`。

### 4.2 当前支持的事件类型

已经支持：

#### immediate
文件一出现就触发：

```json
{"type":"immediate","channelId":"D123","text":"Check inbox"}
```

#### one-shot
在某个时间点触发一次：

```json
{"type":"one-shot","channelId":"D123","text":"Remind me tomorrow","at":"2026-03-29T09:00:00+08:00"}
```

#### periodic
按 cron 周期触发：

```json
{"type":"periodic","channelId":"D123","text":"Daily summary","schedule":"0 9 * * 1-5","timezone":"Asia/Shanghai"}
```

### 4.3 当前触发方式

事件被 watcher 读取后，会被转成 synthetic SlackEvent，再进入现有 channel queue。

也就是说，events 并没有新造一套运行路径，而是复用了当前已有的：

- per-channel queue
- runner
- context
- tool thread logs
- main reply

这一步很关键，因为它保证了：

- Slack 消息触发
- 事件触发

最终走的是同一套执行模型。

### 4.4 当前排队策略

当前已实现：

- synthetic event 始终入队
- 每个 channel 最多排队 5 个事件
- 超过上限直接丢弃并打 warning

这和原先的规划一致。

### 4.5 synthetic event 的历史记录

当前 `main.ts` 已经会把 synthetic event 先写入 `log.jsonl`，再进入执行。

这意味着：

- event 不是纯瞬时信号
- 之后仍然可以在本地历史里看到它触发过什么

---

## 5. usage summary

### 5.1 当前实现

`agent.ts` 现在已经会在每次最终回复完成后，往该回复对应的 thread 再追加一条 usage summary。

### 5.2 当前 summary 内容

当前 summary 已包含：

- input tokens
- output tokens
- cache read tokens
- cache write tokens
- total tokens
- total cost
- 当前 context usage 摘要

### 5.3 当前绑定方式

它不是做成全局统计，而是：

- 跟当前这条主回复绑定
- 发到当前这条回复对应的 thread 下

所以：

- 初始消息有自己的 usage summary
- follow-up 也会有自己的 usage summary
- 不会和别的回复混在一起

### 5.4 当前意义

这让 mom 现在已经具备基本可运营性：

- 知道一轮任务大概用了多少 token
- 知道 cost 大概是多少
- 知道当前上下文大概逼近 context window 的什么位置

对于长期运行 bot，这一块非常重要。

---

## 6. 当前状态总结

截至 `mom4.md` 记录点，`mypi` 中的 `mom` 已经具备：

- Slack 接入
- per-channel workspace / log / context
- follow-up 顺序处理
- sandbox
- mom 工具层
- 附件输入输出
- tool thread logs
- backfill
- skills 发现与 prompt 注入
- events watcher
- usage summary

当前还没补完的重点已经明显缩小为：

- `[SILENT]`
- `log.jsonl` 更严格的防重复
- workspace `settings.json`
- 以及后续一些产品打磨项

---

## 7. 验证结果

已完成：

- `npm install --workspace @mypi/mom croner@^9.1.0`
- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 mom 改动无关

---

## 8. 一句话结论

截至 `mom4.md` 记录点，`mypi` 中的 `mom` 已经完成了 backfill、skills、events、usage summary 这四块关键长期能力，整体上已经从“能工作的 Slack agent”推进到了“具备持续运行、恢复、调度和成本可观测能力的 mom 原型”。
