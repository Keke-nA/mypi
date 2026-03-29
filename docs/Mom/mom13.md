# Mom 进度记录（十三）

日期：2026-03-29

本文记录一轮很小但很实用的能力补齐：**为 mom 增加 `clear` 控制命令**。

---

## 1. 背景

在当前 `mom` 里，一个 Slack channel / DM 会长期对应：

- 一份 `log.jsonl`
- 一份 `context.jsonl`
- 一个缓存的 `AgentRunner`

这意味着，如果用户想“把这个窗口的上文清空，重新开始”，之前并没有直接的用户命令，只能手动：

- 停掉 mom
- 删除该 channel 目录下的文件
- 再重启

这对真实使用体验不够友好。

---

## 2. 这轮新增了什么

本轮已新增：

```text
clear
```

当前在：

- DM
- 或频道里 `@mention` mom

只要消息正文是：

```text
clear
```

mom 就会把这条消息当成控制命令，而不是普通 prompt。

---

## 3. `clear` 的当前语义

当前 `clear` 会做四件事：

### 1) 要求 channel 当前空闲
如果当前该 channel 正在跑任务，mom 会拒绝清空，并提示：

```text
Cannot clear while running. Send `stop` first.
```

这轮故意没有做“运行中强制 clear”，是为了避免一边跑工具一边删上下文文件导致状态不一致。

### 2) dispose 当前 channel runner
这一步会移除当前 channel 的 runner cache，确保旧的 `AgentSession` 不再继续被复用。

### 3) 删除该 channel 的会话文件
当前会删除：

- `<channel>/log.jsonl`
- `<channel>/context.jsonl`

这两份文件一起删，原因是：

- 只删 `context.jsonl` 不够，因为下一次 run 前 `log.jsonl` 还会重新同步回去
- 只删 `log.jsonl` 也不够，因为 `context.jsonl` 和内存中的 runner 还保留着旧上下文

### 4) 清空 `ChannelStore` 的日志去重缓存
这一步很关键。

因为 `store.ts` 内部会缓存每个 channel 已见过的 Slack `ts`。如果只删文件、不清缓存，那么删除后新的消息仍可能被误判成“已经记录过”。

所以这轮新增了 `clearChannelLogCache(channelId)`，在 clear 时一起执行。

---

## 4. `clear` 不会做什么

这轮的 `clear` 只清“会话上下文”，不会清“整个频道工作区”。

也就是说，它**不会删除**：

- `MEMORY.md`
- `skills/`
- `attachments/`
- workspace 根目录下的 `settings.json`
- workspace 根目录下的 `skills/` / `events/`

所以它的语义是：

> 重新开始这个 channel 的对话上下文

而不是：

> 把整个 channel 工作区彻底抹掉

---

## 5. 和 `compact` 的关系

用户同时问到：`coding-agent` 那样的 `compact` 有没有。

当前结论是：

- `mom` 已经复用了 `coding-agent` 的 compaction 机制
- 但它目前仍然是 **auto-compaction**
- 没有单独暴露一个 Slack 里的手动 `compact` 命令

所以现在两者语义更清楚了：

### `clear`
- 重置当前 channel 对话上下文
- 相当于“重新开始”

### auto-compaction
- 不重置，而是压缩旧上下文
- 相当于“瘦身，不失忆”

---

## 6. 实现位置

本轮涉及：

- `package/mom/src/clear.ts`
  - `isClearCommandText(...)`
  - `clearChannelConversationFiles(...)`
- `package/mom/src/store.ts`
  - `clearChannelLogCache(channelId)`
- `package/mom/src/agent.ts`
  - `disposeRunner(channelId)`
- `package/mom/src/slack.ts`
  - 把 `clear` 识别为控制命令
- `package/mom/src/main.ts`
  - `handleClear(...)`
  - runner dispose + 文件删除 + 缓存清理 + Slack 回复

---

## 7. 测试

本轮新增测试：

```text
package/mom/test/clear.test.ts
```

覆盖点包括：

- `clear` 指令识别
- 删除 `log.jsonl` / `context.jsonl`
- 清理 `ChannelStore` 的 `ts` 缓存

已执行：

- `npm run build --workspace @mypi/mom`
- `npx tsx ../../node_modules/vitest/dist/cli.js --run --root ../.. package/mom/test/clear.test.ts`
- `npm run typecheck --workspace @mypi/mom`

结果均通过。

---

## 8. 一句话总结

截至 `mom13.md` 记录点，`mom` 已经补上了一个非常实用的控制命令：

> `clear` 可以在不清空整个工作区的前提下，重置当前 Slack channel / DM 的对话上下文。

这使得 `mom` 在长期运行场景下，终于具备了一个“重新开始当前窗口”的显式入口。
