# Mom 进度记录（七）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的一次稳定性修复：**重复回复去重**。

这一轮主要解决的是一个实际联调里暴露出来的问题：同一条 Slack 消息在某些时序下会被处理两次，最终导致 bot 回两次。

---

## 1. 问题现象

实际测试中，在两个频道同时发消息时，出现了：

- 同一条用户消息在 `log.jsonl` 中出现两次
- bot 对同一条消息给出两次回复

而且两次重复的用户消息 `ts` 完全一样，这说明不是用户真的发了两次，而是**同一条 Slack event 被处理了两次**。

---

## 2. 问题原因

这次问题的根因，和前一轮新增的“离线消息自动补处理”有关。

当前 `mom` 已支持：

- 启动时 backfill 历史
- 然后把离线期间的有效 trigger 自动 replay 进 queue

但在某些时序下，会出现这种重叠：

1. backfill 已经把某条离线消息补到本地
2. backfill replay 又把这条消息排进 queue
3. 与此同时，Socket Mode 的实时事件也把同一条消息送进来
4. 最终同一条 `channel + ts` 被处理两次

所以这不是 LLM 重复输出，而是**同一条 Slack trigger 被重复入队**。

---

## 3. 这轮修了什么

### 3.1 `log.jsonl` 去重

`store.ts` 现在已经新增了按 Slack `ts` 的去重缓存。

当前行为变成：

- 每个 channel 会维护已记录 `ts` 集合
- 再写入 `log.jsonl` 前，先检查该 `ts` 是否已经存在
- 如果已存在，则不重复追加

这一步解决的是：

- 同一条 Slack 消息不会再重复写进 `log.jsonl`

### 3.2 trigger 去重

`slack.ts` 现在也新增了运行时 trigger 去重。

当前采用的 key 是：

```text
channelId:ts
```

也就是说，如果当前进程里某条消息已经作为 trigger 被接收过一次，那么：

- live event 再来一次
- replay event 再来一次

都会被识别成同一条消息，不再重复执行。

### 3.3 replay 也会先登记

这一步很关键：

- backfill replay 在真正 enqueue 之前，也会先把 `channelId:ts` 登记到去重集合里

这样就能挡住一种典型重叠：

- replay 先排进去了
- 然后 Socket Mode 又把同一条消息送进来

现在第二次就会被跳过。

---

## 4. 当前效果

修完之后，这类问题现在应该会被挡住：

- 同一条消息不会再在 `log.jsonl` 中出现两次
- 同一条消息不会再被 live + replay 各跑一遍
- 同一条消息不会再收到两次 bot 回复

也就是说，这一轮实际上补掉了前一轮“自动 replay 离线消息”引入的一个时序型副作用。

---

## 5. 当前状态总结

截至 `mom7.md` 记录点，`mypi` 中的 `mom` 除了已经具备：

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
- 离线期间 trigger 自动补处理

之外，现在还进一步具备：

- `log.jsonl` 基于 Slack `ts` 的去重
- live / replay trigger 去重
- 对同一条消息的重复执行保护

当前仍未完成的重点包括：

- `[SILENT]`
- workspace `settings.json`

---

## 6. 验证结果

已完成：

- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 mom 改动无关

---

## 7. 一句话结论

截至 `mom7.md` 记录点，`mypi` 中的 `mom` 已经把“离线 replay 与实时事件重叠导致双回复”的问题补掉了，同一条 Slack 消息现在有了更明确的单次执行语义。
