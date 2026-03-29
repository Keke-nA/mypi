# Mom 进度记录（六）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的一轮行为语义升级：**离线期间的有效 Slack trigger 会在重启后自动补处理**。

这一轮的重点不是补新基础设施，而是把 backfill 从“只补历史”推进到“补历史后还能自动补执行”。

---

## 1. 之前的行为

在这轮之前，`mom` 的离线恢复语义是：

1. 进程下线期间的 Slack 消息会在重启时通过 backfill 补到本地 `log.jsonl`
2. 但这些消息不会自动触发回复
3. 只有等下一次新的有效触发到来时，runner 才会在运行前把这些漏掉的消息同步进 `context.jsonl`
4. 然后模型会在处理“新消息”的时候顺便看到这些旧消息

这种做法在工程上是稳的，但体验上会出现一种很奇怪的感觉：

- 用户离线时问了 bot
- bot 重启后并不会补回
- 直到用户再催一次，bot 才会说“抱歉，刚才漏回了”

---

## 2. 这轮改成了什么

这轮把 backfill 语义升级成：

> **补历史 + 自动补处理离线期间的有效 trigger**

也就是说，重启后不再只是“把消息记回来”，而是会把符合触发条件的离线消息重新排回当前 channel queue 执行。

---

## 3. 当前自动补处理的范围

### 3.1 会自动补处理的

当前会在重启后自动 replay 的是：

- DM 消息
- 有效 `@mention`

这里的“有效”指的是：

- 有正文，或者
- 有附件

并且它们是 `mom` 下线期间新增、此前本地 `log.jsonl` 还没有记录过的消息。

### 3.2 不会自动补处理的

以下仍然不会在重启后自动 replay：

- 普通频道聊天消息（即使会 backfill 到 `log.jsonl`）
- 只有 mention、没有正文也没有附件的空触发
- `stop` 离线消息
- 其他 bot 的消息

所以当前语义仍然是有边界的，不是把所有补回来的历史都重新执行一遍。

---

## 4. 当前执行方式

### 4.1 先 backfill，再 replay

当前流程是：

1. 启动时先做 backfill
2. 把离线期间的新消息追加到本地 `log.jsonl`
3. 从这些新消息里筛出“本来就应该触发 mom 的消息”
4. 把它们转成 `SlackEvent`
5. 再按 channel queue 排回执行

也就是说，当前不是凭空“补发回复”，而是：

- 先恢复历史
- 再把应处理的 trigger 回灌进原有运行链路

### 4.2 仍然复用原有 queue / runner

这一步没有新造第二套执行系统，而是继续复用现有：

- per-channel queue
- runner
- context sync
- tool thread logs
- usage summary

所以重启补处理和在线实时处理，最终走的是同一条执行路径。

### 4.3 同一 channel 按时间顺序逐条处理

如果同一 DM / channel 在线下期间积累了多条有效 trigger，当前会：

- 先按时间顺序补回
- 再按 queue 顺序逐条处理
- 每条消息各自产生自己的主回复和 thread

这点很重要，因为它避免了把所有离线消息糊成一次回复。

---

## 5. 当前产品语义

这轮之后，离线恢复的语义变成：

- 下线期间的普通消息：恢复历史，但不自动执行
- 下线期间的 DM / 有效 `@mention`：恢复历史，并自动补执行

这更接近用户直觉：

- 如果用户明确在对 bot 说话
- 那么 bot 重启后应该尽量补回，而不是让用户再催一次

---

## 6. 这轮的意义

这轮改动解决的是一个很典型的体验问题：

> bot 不应该只是“记住我离线时说过什么”，还应该“尽量把漏掉的该回的话补回来”。

因此现在的 `mom`：

- 不只是具备 backfill
- 而是具备了更完整的“离线恢复 + 补执行”语义

这对长期运行 bot 很关键。

---

## 7. 当前状态总结

截至 `mom6.md` 记录点，`mypi` 中的 `mom` 在前面已经具备：

- Slack 接入
- per-channel 上下文
- follow-up 顺序处理
- sandbox
- 附件输入输出
- tool thread logs
- backfill
- skills
- events
- usage summary
- 旧格式 `context.jsonl` 自动恢复

基础上，现在进一步具备：

- 重启后自动补处理离线期间的 DM
- 重启后自动补处理离线期间的有效 `@mention`
- 仍然保持普通聊天消息只入历史、不自动执行

当前仍未完成的重点包括：

- `[SILENT]`
- `log.jsonl` 更严格的防重复
- workspace `settings.json`

---

## 8. 验证结果

已完成：

- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 mom 改动无关

---

## 9. 一句话结论

截至 `mom6.md` 记录点，`mypi` 中的 `mom` 已经把离线恢复语义从“只补历史”升级成了“对 DM / 有效 `@mention` 同时补历史和补执行”，整体行为更接近一个真正长期在线的 Slack worker。
