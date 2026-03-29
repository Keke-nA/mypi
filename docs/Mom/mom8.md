# Mom 进度记录（八）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的一轮启动期体验修复：**replay backlog 提示 + 启动期 live 消息缓冲**。

这一轮主要解决的是一个体验层面的时序问题：

- 重启后 `mom` 会自动 replay 离线期间的有效 trigger
- 但如果这时用户又立刻发了新消息
- 频道尾部就可能出现“旧 backlog 的 bot 回复”和“刚发的新消息”混在一起

这会让人误以为又重复了，或者误以为当前消息的回复顺序不对。

---

## 1. 之前的行为

在这轮之前，启动流程大致是：

1. backfill 历史
2. 启动 Socket Mode
3. 把 replay backlog 排回 queue
4. 新来的 live 消息继续按实时链路直接处理

这会带来两个体验问题：

### 1.1 用户看不出来现在是在补跑 backlog

频道里会突然连续出现几条 bot 回复，但用户未必知道这些其实是在“补回离线期间漏掉的 trigger”。

### 1.2 新 live 消息会和 backlog 输出交错

虽然每个 channel 仍然是串行 queue，但 live 消息会先被实时写进 `log.jsonl`，于是从日志尾部和 Slack 视觉上看，会像这样：

- 新用户消息已经出现了
- 但后面先跟着几条旧 backlog 的 bot 回复
- 最后才轮到刚刚那条新消息自己的回复

逻辑上没错，但体验很乱。

---

## 2. 这轮改成了什么

这轮补了两件事：

### 2.1 replay backlog 状态提示

如果启动后某个 channel 有离线 trigger 需要 replay，当前会先在该 channel 发一条临时状态消息：

```text
_Replaying N offline messages..._
```

这样频道里的人会知道：

- 现在这几条 bot 回复不是“发疯了”
- 而是在补跑离线期间积压的 trigger

### 2.2 启动期 live 消息先缓冲

如果当前启动阶段还有 replay backlog 没跑完，那么新到达的 live 消息现在不会立刻进入正常处理链路，而是会：

1. 先 ack Slack event
2. 暂存在内存缓冲队列里
3. 等 replay backlog 跑完后
4. 再按到达顺序恢复处理

这样做的直接效果是：

- backlog 的 bot 回复会先完整跑完
- 然后才开始处理新的 live 消息
- 频道尾部顺序会更干净

---

## 3. 当前具体语义

### 3.1 backlog 没跑完前

启动期间如果有 replay backlog：

- live DM 会先缓冲
- live `@mention` 会先缓冲
- live 普通频道消息也会先缓冲

这里的“缓冲”指的是：

- 先不写入 `log.jsonl`
- 先不进入 queue 执行
- 先等 backlog replay 完成

### 3.2 backlog 跑完后

当前会：

1. 删除临时 replay 状态消息
2. 依次恢复缓冲中的 live 消息
3. 按原有逻辑继续：
   - 写入 `log.jsonl`
   - DM / mention 触发 run
   - 普通频道消息仅记日志

### 3.3 仍然保持 per-channel queue

这轮没有改掉原有架构：

- 每个 channel 仍然有自己的 queue
- 每个 channel 仍然有自己的 runner / `context.jsonl`
- 不同 channel 仍然可以并行

变化只是：

- 在启动 replay 阶段，live 消息会先被暂存
- 等 replay backlog 真正跑空后，再恢复 live 流量

---

## 4. 为了支持这件事，补了什么底层能力

### 4.1 `ChannelQueue.onIdle()`

为了知道某个 channel 的 replay backlog 是否真的已经跑完，`ChannelQueue` 现在新增了 `onIdle()`。

这让 `slack.ts` 可以等待：

- replay 事件真正执行完成
- 而不只是“已经 enqueue 完了”

### 4.2 buffered live works

启动期间，live 消息现在不直接执行，而是先变成待恢复的 work 保存在内存里。

等 replay 阶段结束后，再把这些 work 逐个恢复执行。

---

## 5. 这轮修复的价值

这轮不是在补新功能，而是在补产品行为一致性：

- replay backlog 有可见提示
- startup replay 与 live traffic 不再交错得太乱
- `log.jsonl` 尾部会更接近人类直觉看到的顺序

所以它主要修的是：

> “系统是对的，但人看起来不对。”

---

## 6. 当前状态总结

截至 `mom8.md` 记录点，`mypi` 中的 `mom` 除了已经具备：

- Slack 接入
- per-channel context
- follow-up 顺序处理
- sandbox
- 附件输入输出
- tool thread logs
- backfill
- skills
- events
- usage summary
- 旧格式 `context.jsonl` 自动恢复
- 离线 trigger 自动补处理
- live / replay trigger 去重

之外，现在还进一步具备：

- replay backlog 状态提示
- 启动期 live 消息缓冲
- replay backlog 先跑完、再恢复 live 流量的启动语义

当前仍未完成的重点包括：

- `[SILENT]`
- workspace `settings.json`

---

## 7. 验证结果

已完成：

- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 mom 改动无关

---

## 8. 一句话结论

截至 `mom8.md` 记录点，`mypi` 中的 `mom` 已经把“启动时 backlog replay 与新 live 消息交错”的体验问题压下去了：现在会先明确提示正在 replay，然后等 replay backlog 跑完，再恢复处理新的 live 消息。
