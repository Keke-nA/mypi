# Mom 进度记录（十一）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的一轮收尾实现：**`[SILENT]` + workspace `settings.json`**。

---

## 1. `[SILENT]` 已实现

这一轮之前，`mom` 虽然已经有 `events/`，但还缺一个关键的长期运行语义：

- 定时检查没有新内容时
- 不应该每次都在 Slack 里发一条“没事发生”

现在这一点已经补上。

### 当前行为

如果模型最终回复为：

```text
[SILENT]
```

当前 `mom` 会：

- 删除这次 run 的 `_Thinking..._` 主消息
- 删除这次 reply 已经发出的 thread 日志
- 不再追加 usage summary
- 不把 `[SILENT]` 文本写进 `log.jsonl`

也就是说，从 Slack 视角看，这次 run 就像“安静地检查过，但没有发消息”。

这正是 periodic / background checks 需要的语义。

### prompt 侧也补了说明

`agent.ts` 构建 system prompt 时，现在已经明确告诉模型：

- 如果是 periodic / background check
- 且没有任何值得报告的内容
- 就应该只回复 `[SILENT]`

所以这不只是 harness 侧支持了静默删除，模型侧也被明确教会了何时使用它。

---

## 2. workspace `settings.json` 已实现

这一轮还补上了 workspace 级运行配置文件：

```text
<workingDir>/settings.json
```

### 当前支持的字段

目前 `mom` 会读取并应用这些字段：

```json
{
  "openai": {
    "model": "gpt-5-mini",
    "baseUrl": "https://your-openai-compatible-endpoint/v1"
  },
  "agent": {
    "thinkingLevel": "minimal",
    "systemPromptAppend": "Prefer concise answers.",
    "compaction": {
      "enabled": true,
      "thresholdPercent": 55,
      "reserveTokens": 20000,
      "keepRecentTokens": 10000,
      "retryOnOverflow": true,
      "showUsageInUi": true
    }
  }
}
```

### 当前语义

`main.ts` 现在会把 workspace `settings.json` 合并到 mom 的有效运行配置里。

也就是说，当前可以通过 `settings.json` 影响：

- model
- baseUrl
- thinking level
- system prompt append
- auto-compaction 设置

### 生效时机

这轮的实现不是只在进程启动时读一次。

当前逻辑是：

- 在新的 run 准备拿 runner 时
- 重新读取 workspace `settings.json`
- 如果有效配置发生变化
- 就基于新配置重建该 channel 的 runner

所以这类设置是**按后续新 run 生效**的，而不是写死在第一次启动里。

这点对长期运行很关键，因为现在你可以直接改 workspace 里的 `settings.json`，而不必为了 model / compaction 之类改代码。

---

## 3. 这轮的意义

这两块其实都是“长期运行收尾项”：

### `[SILENT]`
解决的是：

- event / cron 驱动任务太吵
- 没事也一直刷频道

### `settings.json`
解决的是：

- workspace 虽然已经有 `MEMORY.md` / `skills/` / `events/`
- 但还缺一份真正的全局运行配置入口

补完之后，workspace 结构更完整了：

```text
<workingDir>/
  MEMORY.md
  settings.json
  skills/
  events/
  <channel>/
```

也就是说，`mom` 的长期运行工作区，现在已经同时具备：

- 记忆
- 技能
- 事件
- 配置

---

## 4. 测试

这轮新增了定向测试：

```text
package/mom/test/settings-and-silent.test.ts
```

覆盖点包括：

- `settings.json` 的读取
- `settings.json` 对 base config 的合并
- `[SILENT]` marker 判定

已执行：

- `npm run build --workspace @mypi/mom`
- `npx tsx ../../node_modules/vitest/dist/cli.js --run --root ../.. package/mom/test/settings-and-silent.test.ts`
- `npm run typecheck --workspace @mypi/mom`

结果均通过。

另外也复查了根级：

- `npm run typecheck`

仍然只剩仓库既有的 `package/coding-agent/test/*` 历史类型错误，与这轮 `mom` 改动无关。

---

## 5. 一句话结论

截至 `mom11.md` 记录点，`mypi` 中的 `mom` 已经补上了长期运行所需的两个关键收尾能力：

- 用 `[SILENT]` 做真正的静默完成
- 用 workspace `settings.json` 管理全局运行配置

这意味着当前这版 `mom` 的大块基础能力已经基本收齐，后续更偏向体验优化和新增需求实现。
