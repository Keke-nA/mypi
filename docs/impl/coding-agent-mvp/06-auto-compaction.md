# 06 Auto-Compaction

本阶段新增文件：

- `package/coding-agent/src/core/context-usage.ts`
- `package/coding-agent/test/context-usage.test.ts`
- `package/coding-agent/test/auto-compaction.test.ts`

本阶段修改文件：

- `package/coding-agent/src/core/session-runtime.ts`
- `package/coding-agent/src/core/agent-session.ts`
- `package/coding-agent/src/core/session-compaction.ts`
- `package/coding-agent/src/config/config.ts`
- `package/coding-agent/src/cli/main.ts`
- `package/coding-agent/src/ui/interactive-app.ts`
- `package/coding-agent/src/index.ts`
- `package/coding-agent/test/config.test.ts`
- `package/coding-agent/test/session-runtime.test.ts`

## 目标

把已有的 manual `/compact` 能力推进成真正可日常使用的产品层策略：

- 能估算当前 context usage
- 能在达到阈值时自动 compact
- 能在 context overflow 时自动 compact 并重试一次
- 能在 CLI/TUI 中把状态展示出来

## 已实现能力

### 1. `getContextUsage()`

当前 coding-agent 已实现一套对齐 `pi` 思路的 context usage 计算：

- 优先使用最后一个有效 assistant message 的真实 usage
- 对其后的 trailing messages 做估算
- 没有 usage 时 fallback 到 estimate-only
- latest compaction 后若还没有新的 post-compaction assistant usage，则返回 unknown

### 2. 80% threshold auto-compaction

当前默认策略为：

- `thresholdPercent = 80`
- `reserveTokens = 16384`
- `keepRecentTokens = 20000`

运行时在 turn 完成后检查当前 context usage，达到阈值即自动 compact。

### 3. overflow recovery compact

当 assistant error 被识别为 context overflow 语义时：

- 不把这条 error assistant message 持久化进 session
- 自动 compact
- compact 成功后自动 `continue()` 一次
- 避免把 overflow 错误永久污染到 session context 中

### 4. runtime event queue 串行化

为了避免：

- message 持久化
- auto-compaction
- retry continue
- 外部命令调用

之间的时序竞争，本轮把 `SessionRuntime` 的 agent 事件处理串成了一条内部队列。

同时：

- `AgentSession.prompt()`
- `AgentSession.continue()`

现在会等待 runtime settle 完成之后再返回。

这意味着调用方看到的返回时刻，已经包含：

- session entry 落盘
- auto-compaction（如果触发）
- overflow retry（如果触发）

## UI / CLI 变化

### plain CLI

新增输出：

- `auto-compact> start (threshold|overflow)`
- `auto-compact> done`
- `auto-compact> done (retrying)`
- `auto-compact> failed: ...`
- `context> 73.2%/...`

### TUI

新增展示：

- status 区显示 `ctx ...`
- transcript notice 显示 auto-compaction start / done / failed
- auto-compaction 期间会临时禁用提交

### `/session` / `/config`

- `/session` 现在会显示当前 context usage
- `/config` / `--print-config` 现在会显示 compaction 配置

## 配置接入

当前已支持：

```json
{
  "agent": {
    "compaction": {
      "enabled": true,
      "thresholdPercent": 80,
      "reserveTokens": 16384,
      "keepRecentTokens": 20000,
      "retryOnOverflow": true,
      "showUsageInUi": true
    }
  }
}
```

并且仍然遵循当前统一优先级：

```text
defaults -> global config -> project config -> explicit config -> preset -> env -> CLI
```

## 当前限制

- 仍然使用保守估算，不是 provider-specific 精确 tokenizer
- overflow 错误识别目前基于通用 error message pattern
- 还没做单独的 `/auto-compact` 运行时控制命令
- 还没做更细的 auto-compaction 可视化面板
