# Mom 进度记录（五）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 的一次兼容性修复：**旧格式 `context.jsonl` 自动恢复**。

这轮不是新增大功能，而是把已经做出来的 backfill / events / usage / skills 真正变成“能稳定跑起来”的版本。

---

## 1. 问题背景

在上一轮补完 backfill、events、skills、usage summary 之后，实际重启联调时暴露出一个问题：

- Slack backfill 已经能正常执行
- events watcher 也已经成功启动
- 但在真正开始处理消息前，runner 会因为 `context.jsonl` 打不开而崩掉

报错形式是：

```text
Missing session header in .../context.jsonl
```

乍看像是 `context.jsonl` 没 header，但实际检查后发现并不是“没有 header”，而是：

- 文件内容是 pretty-printed JSON
- 不是一行一个 JSON entry 的 JSONL / NDJSON

而 `SessionManager.open()` 期望的是：

- 第一行是完整 session header JSON
- 后面每一行也是完整 entry JSON

所以旧文件虽然“内容上有 header”，但“格式上不是合法 session JSONL”，最终还是会被判成坏文件。

---

## 2. 这轮修了什么

### 2.1 runner 创建前先校验 `context.jsonl`

`agent.ts` 现在已经会在创建 runner 前：

- 先检查 `context.jsonl` 是否存在
- 如果存在，进一步校验它能不能被 `SessionManager.open()` 正常读取

也就是说，当前不再假设“文件存在就一定可用”。

### 2.2 自动修复旧的 pretty-printed `context.jsonl`

这轮新增了一个恢复流程：

- 读取旧文件
- 从文件里提取嵌入的 JSON object
- 保留 session header 和 session entries
- 重新写成合法 JSONL：一行一个 JSON object

修复前会先备份原文件。

因此，对于这类“内容有，但格式不对”的旧文件，现在已经可以自动恢复，而不是直接崩掉。

### 2.3 修不了时自动重建

如果文件已经坏到没法修，比如：

- 根本提取不出合法 header
- 内容缺失过多
- 结构严重破坏

那当前逻辑会：

1. 先备份坏文件
2. 重建一个最小合法的 `context.jsonl`
3. 再依赖 `log.jsonl -> context.jsonl` 同步机制恢复用户侧上下文

这意味着现在即使遇到坏文件，也更偏向：

- 尽量修
- 修不了就恢复可运行状态

而不是直接让 mom 起不来。

---

## 3. 额外顺手修掉的稳定性问题

### 3.1 runner cache 不再记住 rejected promise

这轮还补了一个实际稳定性问题：

- 如果某次 `createRunner()` 失败
- 之前的缓存可能会把这个 rejected promise 留在 cache 里
- 后续再试，可能会一直命中这次失败

现在已经改成：

- runner 创建失败时，会清掉对应 channel 的 rejected cache

这样后续重试不会被旧失败状态卡死。

### 3.2 channel queue 补了兜底异常保护

`slack.ts` 的 `ChannelQueue` 现在也补了保护：

- 单次队列任务如果抛出未捕获异常
- 不会直接把整个进程打死
- 会记录 warning，再继续处理后续任务

这一步对长期运行 bot 也很重要。

---

## 4. 实际验证结果

这轮不是只做了类型通过，而是拿真实坏文件验证了恢复链路。

实际验证对象：

```text
/home/gao-wsl/mypi/.mom-data/D0AMY87N7LN/context.jsonl
```

验证结果：

- 已成功识别它是 pretty-printed 旧格式
- 已先备份原文件
- 已重写成合法 JSONL
- 修复后可以成功创建 runner

修复后的文件现在已经是这种形式：

```json
{"type":"session", ...}
{"type":"model_change", ...}
{"type":"thinking_level_change", ...}
{"type":"message", ...}
```

也就是 `SessionManager.open()` 能正确消费的格式。

---

## 5. 这轮的意义

这轮修复之后，上一轮新补的功能才真正更稳地落地：

- backfill 不是只补回历史，然后因为 context 坏文件又崩掉
- events watcher 启动后，也不会因为旧 channel 的 context 文件异常直接卡死
- 长期运行时对旧数据格式更有兼容性
- 重启恢复链路更接近真正可用

换句话说，这轮是一次很关键的“兼容性收尾”。

---

## 6. 当前状态总结

截至 `mom5.md` 记录点，`mypi` 中的 `mom` 除了前面已经完成的：

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

之外，现在还具备：

- 旧格式 `context.jsonl` 自动修复
- 无法修复时自动重建 session 文件
- runner 创建失败后的 cache 自恢复
- channel queue 的未捕获异常保护

当前仍未完成的重点包括：

- `[SILENT]`
- `log.jsonl` 更严格的防重复
- workspace `settings.json`

---

## 7. 验证结果

已完成：

- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 使用真实损坏文件验证修复链路成功
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 mom 改动无关

---

## 8. 一句话结论

截至 `mom5.md` 记录点，`mypi` 中的 `mom` 已经不只是功能上补齐了 backfill / skills / events / usage，还把旧格式 `context.jsonl` 的恢复能力补上了，整体可运行性明显更稳了一步。
