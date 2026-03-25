# Coding-Agent Auto-Compaction 产品化实施稿

## 1. 文档定位

这份文档不是重写 `session` 层的 compaction 基础语义。

已有基础语义仍然以这些文档为准：

- `docs/plan/session/README.md`
- `docs/plan/session/compaction.md`
- `docs/plan/session/runtime.md`
- `docs/plan/session/testing.md`

本稿只补充一个更产品化的问题：

```text
coding-agent 何时自动 compact、如何估算当前上下文占用、overflow 时如何恢复、UI/配置如何暴露
```

也就是说：

- `session/compaction.md` 负责“compaction 是什么”
- 本文负责“compaction 什么时候自动发生，以及像 pi 一样如何用起来”

---

## 2. 当前已完成基础

截至目前，`mypi` 中已经完成：

- session tree append-only 持久化
- `buildSessionContext()` 语义
- manual `/compact`
- rolling compaction（只认 latest compaction）
- branch summary
- CLI/TUI 交互入口
- `~/.mypi/agent/config.json` / `presets.json` 配置加载
- `ai` 层的 `usage / cost / contextWindow / maxTokens`

当前**还没有完成**：

- 自动 threshold compaction
- context overflow recovery compact
- 类似 `pi` 的 `getContextUsage()`
- TUI/CLI 中 context usage 百分比展示
- compaction 配置项的正式产品化暴露

因此，当前状态可以概括为：

```text
compaction 基础能力已经有了，但 auto-compaction 产品策略还没接上
```

---

## 3. 对标原始 pi 的现状结论

参考 `pi` 当前文档与实现，核心结论如下。

### 3.1 `pi` 如何估算当前 context tokens

`pi` 不是单纯依赖 cost，也不是每次都重新全量 tokenizer。

它的策略是：

1. 优先取**最后一个有效 assistant message 的真实 usage**
2. 如果该 message 之后又追加了新的 trailing messages
3. 则只对 trailing messages 做**估算**
4. 最终：

```text
contextTokens = lastAssistantUsageContextTokens + trailingEstimatedTokens
```

其中真实 usage 的 context tokens 语义是：

```text
usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite
```

### 3.2 `pi` 的 trailing token estimate 不是精确 tokenizer

`pi` 对后续消息采用保守估算，核心是：

```text
chars / 4
```

并按 message role 分别处理：

- user text
- assistant text / thinking / tool call args
- tool result
- branch summary
- compaction summary
- image 固定估值

### 3.3 `pi` 会避免使用 stale pre-compaction usage

`pi` 处理了一个很关键的问题：

```text
compact 之后，旧 assistant usage 反映的是 compact 前的大上下文，不能继续拿来判断当前是否该再次 compact
```

因此：

- 如果 branch 上已经存在最新 compaction
- 但 compaction 之后还没有新的成功 assistant usage
- 则当前 context usage 视为 `unknown`

这是为了避免：

- 刚 compact 完立刻再次触发 compact
- stale usage 导致 auto-compaction 死循环

### 3.4 `pi` 默认阈值不是 80%

`pi` 文档里的默认触发条件是：

```text
contextTokens > contextWindow - reserveTokens
```

默认值：

- `reserveTokens = 16384`
- `keepRecentTokens = 20000`

这意味着它通常在 **80% 以上、但不是固定 80%** 才触发。

---

## 4. 本项目本轮要实现的需求

本项目这轮不完全照搬 `pi` 的默认阈值，而是采用用户明确指定的产品策略：

```text
达到模型上下文窗口的 80% 时自动 compact
```

### 4.1 本轮目标

要补齐四件事：

1. 当前 context usage 计算能力
2. threshold auto-compaction
3. overflow recovery compact
4. TUI / config 暴露

### 4.2 当前轮的判定原则

本轮以 `80%` 为主阈值。

建议触发公式：

```text
triggerTokens = min(
  floor(contextWindow * thresholdPercent / 100),
  contextWindow - reserveTokens
)

当 contextTokens >= triggerTokens 时触发 compact
```

默认值建议：

- `thresholdPercent = 80`
- `reserveTokens = 16384`
- `keepRecentTokens = 20000`

这样做的原因：

- 用户想要固定 `80%` 触发
- 仍然保留 `reserveTokens` 作为安全护栏
- 后续如果要向 `pi` 默认行为靠拢，也不用推翻配置结构

---

## 5. 配置需求

建议在 `config.json` 中新增：

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

### 字段语义

- `enabled`
  是否启用 auto-compaction
- `thresholdPercent`
  threshold 触发百分比，默认 `80`
- `reserveTokens`
  额外保留给 prompt / 输出的空间
- `keepRecentTokens`
  compact 时保留的原始 suffix 预算
- `retryOnOverflow`
  overflow compact 完成后是否自动重试一次
- `showUsageInUi`
  是否在 TUI/CLI 状态区显示 context usage

### 配置优先级

沿用当前 coding-agent 配置优先级：

```text
defaults -> global config -> project config -> explicit config -> preset -> env -> CLI
```

---

## 6. 运行时算法要求

## 6.1 `getContextUsage()`

建议新增一个产品层能力：

```ts
interface ContextUsageSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  source: "usage+estimate" | "estimate-only" | "unknown";
}
```

### 计算规则

1. 取当前 active model 的 `contextWindow`
2. 找到当前 branch 上 latest compaction
3. 在当前有效上下文中寻找**最后一个有效 assistant usage**
4. 如果没有任何 usage：
   - 对全部 current messages 做 estimate
   - `source = "estimate-only"`
5. 如果有 usage：
   - 使用 `usage.totalTokens || input + output + cacheRead + cacheWrite`
   - 对其后的 trailing messages 做 estimate
   - `source = "usage+estimate"`
6. 如果存在 latest compaction，但**没有 post-compaction 的成功 assistant usage**：
   - 返回 `tokens = null`
   - 返回 `percent = null`
   - `source = "unknown"`

### 估算规则

不要单独引入复杂 tokenizer。

第一版直接复用当前 `chars / 4` 近似法即可，但应统一成单独函数，供：

- usage snapshot
- compaction cut point
- UI 展示
- 测试

共同使用。

---

## 6.2 threshold auto-compaction

### 触发时机

建议挂在一次成功 turn 结束后。

也就是：

- assistant 成功完成本轮
- message 已写入 session
- 当前 runtime 没在 compacting
- auto-compaction 已启用
- 当前 usage 达到阈值

则自动执行一次 compact。

### 约束

必须满足：

- 不在 streaming 中途触发
- 不与 `/compact` 并发
- 不在刚 compact 完但 usage 仍未知时误触发
- 不出现一次 turn 结束后连续触发多次 compact

### 行为

触发后：

1. 停止输入/继续队列
2. 调用当前 compaction summary generator
3. 追加 compaction entry
4. rebuild context
5. 将 Agent messages 替换为 compact 后上下文
6. UI 显示本次 auto-compaction 的起止 notice

---

## 6.3 overflow recovery compact

这是和 threshold compact 分开的第二条路径，不能省略。

### 触发条件

当模型返回的 assistant error 明确属于以下语义之一时触发：

- context window exceeded
- too many tokens
- model_context_window_exceeded
- context length exceeded
- provider 的等价错误文本

### 行为要求

1. 识别这是 overflow，而不是普通 4xx/5xx 或 rate limit
2. 把这条报错 assistant message 从当前 runtime context 中移除
3. 执行一次 compact
4. compact 成功后**只自动重试一次**
5. 如果重试再次 overflow，不要进入无限循环

### 注意点

必须区分：

- overflow 错误
- quota / auth / rate limit / provider unavailable

只有 overflow 适合自动 compact + retry。

---

## 6.4 UI / CLI 暴露

### TUI

建议在状态区显示：

```text
ctx 73.2%/128k
```

如果 usage 暂时未知，则显示：

```text
ctx ?/128k
```

另外需要显示：

- auto-compaction start
- auto-compaction complete
- auto-compaction failed
- overflow retrying after compaction

### Plain CLI

plain 模式不需要复杂 UI，但应至少输出：

- `auto-compact> start (threshold)`
- `auto-compact> done`
- `auto-compact> failed: ...`
- `auto-compact> retrying last prompt after overflow recovery`

### `/config`

`/config` 输出中应包含当前 compaction 设置。

---

## 7. 文件落点建议

建议本轮实现时改这些文件。

### 新增文件建议

- `package/coding-agent/src/core/context-usage.ts`
- `package/coding-agent/test/context-usage.test.ts`
- `package/coding-agent/test/auto-compaction.test.ts`

### 需要修改的现有文件

- `package/coding-agent/src/core/session-compaction.ts`
  - 抽出统一 token estimate helper
  - 复用到 cut point / usage snapshot
- `package/coding-agent/src/core/session-runtime.ts`
  - 挂 auto-compaction 触发
  - 处理 overflow recovery
- `package/coding-agent/src/core/agent-session.ts`
  - 暴露 `getContextUsage()` / auto-compaction 状态
- `package/coding-agent/src/config/config.ts`
  - 新增 compaction 配置解析
- `package/coding-agent/src/cli/main.ts`
  - `/config` 增加 compaction 输出
  - plain CLI 提示 auto-compaction 状态
- `package/coding-agent/src/ui/interactive-app.ts`
  - 状态区展示 context usage
  - notice 展示 auto-compaction 生命周期
- `docs/impl/coding-agent-mvp/04-validation.md`
  - 记录新测试和 smoke

---

## 8. 建议实现顺序

建议按下面顺序做，避免边实现边打架：

1. 抽出 `getContextUsage()` 与统一 token estimate
2. 先补 `context-usage.test.ts`
3. 在 `session-runtime.ts` 接 threshold auto-compaction
4. 再接 overflow recovery compact
5. 接配置解析
6. 最后接 TUI / plain CLI 展示
7. 补 validation 文档与 smoke

---

## 9. 验收标准

本轮实现完成后，至少要满足：

### 9.1 usage 计算

- 能基于最后一次 assistant usage + trailing estimate 计算当前 context usage
- 没有 usage 时能 fallback 到 estimate-only
- latest compaction 后若没有新的成功 assistant usage，不使用 stale usage

### 9.2 threshold compact

- context 达到 `80%` 时自动 compact
- 不会在一次 turn 后连续触发多次 compact
- compact 后 Agent context 被替换为 compact 后视图

### 9.3 overflow recovery

- context overflow error 会触发 compact + 单次重试
- 非 overflow 错误不会误触发 compact
- 不会进入无限 retry 循环

### 9.4 UI / config

- TUI/CLI 能看到当前 context usage
- `/config` 能看到 compaction 配置
- warning / failure 能清楚展示给用户

### 9.5 兼容性

- 现有 `/compact` 手动命令语义不变
- 现有 session tree / branch summary / fork / resume 语义不变
- 不破坏已有 build/test/smoke

---

## 10. 当前明确非目标

本轮先不做：

- provider-specific 精确 tokenizer
- 多模型动态阈值策略优化
- 背景异步 compaction 队列
- 复杂的压缩确认弹窗
- 主题级 fancy context usage 图形化组件

---

## 11. 一句话结论

当前 `mypi` 已经有：

```text
manual compaction 的基础设施
```

本稿要补的是：

```text
像原始 pi 一样可日常使用的 auto-compaction 产品层策略
```

但这轮产品决策里，threshold 以**固定 80%** 为主，而不是完全照搬 `pi` 的 `contextWindow - reserveTokens` 默认策略。
