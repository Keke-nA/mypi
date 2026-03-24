# AI 层当前实现说明

本文档描述的是仓库当前已经落地的 `package/ai` 实现，不是规划态文档。

对应规划文档：

- `docs/plan/ai.md`
- `docs/plan/agent.md`

当前代码位置：

- `package/ai/src`
- `package/agent/src`

## 1. 定位

`AI` 层的职责是把不同 provider 的调用协议收敛成一套统一接口，对上只暴露：

- `createAIClient(config)`
- `client.complete(model, context, options)`
- `client.stream(model, context, options)`

这一层只解决“如何稳定调用模型”，不负责：

- `Agent` 状态机
- turn loop
- tool 真正执行
- session / branch / UI

当前 `Agent` 层只依赖 `AIClient` 抽象，不直接依赖任何 OpenAI / Anthropic 细节。

## 2. 代码结构

当前 `package/ai/src` 可以分成 6 个部分：

1. `types.ts`
   定义统一协议，包括消息结构、工具结构、流式事件、完成结果、错误形状、模型目录项和 provider adapter 接口。
2. `client.ts`
   组装统一客户端，负责模型解析、默认 catalog 装配、provider adapter 路由。
3. `catalog.ts`
   维护默认模型目录，解析 `ModelRef`，合并模型默认参数和调用参数。
4. `router.ts`
   按 provider 选择 adapter。
5. `config.ts` / `http.ts` / `errors.ts` / `sse.ts`
   处理鉴权读取、超时与取消、统一错误模型、SSE 读取。
6. `providers/*.ts`
   厂商适配层。当前已有：
   - `providers/openai.ts`
   - `providers/anthropic.ts`

可以把当前架构理解成：

```text
Agent / 上层调用方
        |
        v
   createAIClient
        |
        v
 model catalog + option resolve
        |
        v
      router
   /           \
openai      anthropic
 adapter      adapter
        |
        v
  unified completion / unified stream events
```

## 3. 统一协议

当前已经稳定下来的统一协议主要包括：

- `ModelRef`
  只要求上层传逻辑模型 id，可选显式 provider。
- `AIContext`
  目前核心就是 `messages`，消息角色覆盖 `system` / `user` / `assistant` / `tool`。
- `ToolSchema`
  统一工具声明，使用 `name + description + inputSchema`。
- `AICallOptions`
  定义统一调用参数。
- `AIStreamEvent`
  统一流式事件，固定为：
  - `response.started`
  - `text.delta`
  - `tool-call.delta`
  - `response.completed`
  - `response.error`
- `AICompletion`
  统一完整结果，包含最终 assistant message、tool calls、finish reason、usage 和 provider metadata。
- `AIError`
  统一错误对象，包含 `code / provider / retryable / status / details`。

这套协议是 `Agent` 层和 provider adapter 之间的边界。

## 4. 初始化和路由流程

`createAIClient(config)` 当前做了这几件事：

1. 通过 `createModelCatalog()` 建立模型目录。
2. 默认装配 `OpenAIProviderAdapter` 和 `AnthropicProviderAdapter`。
3. 在每次调用时：
   - 用 `resolveModel()` 把 `ModelRef` 解析成 catalog 项。
   - 用 `resolveCallOptions()` 把模型默认参数与本次调用参数合并。
   - 用 `getProviderAdapter()` 按 provider 找到具体 adapter。
   - 调 adapter 的 `complete()` 或 `stream()`。

当前默认 catalog 内置了 3 个逻辑模型：

- `gpt-5.4`
- `gpt-4o-mini`
- `claude-3-5-sonnet-latest`

调用方也可以通过 `config.catalog` 覆盖默认条目。

## 5. OpenAI 适配实现

### 5.1 路由策略

OpenAI adapter 当前内部不是单一路径，而是按模型和运行环境分流：

- `gpt-5.*` 走 `Responses API`
- 其它 OpenAI 模型默认走 `Chat Completions`
- 未显式注入 `fetch` 时，优先走 OpenAI SDK
- 显式注入 `fetch` 时，优先走兼容 HTTP / relay 路径

这样做的目标是同时兼容：

- 官方 OpenAI API
- 中转地址 / relay
- SDK 直连
- fetch 驱动的测试与集成场景

### 5.2 已实现的兼容逻辑

OpenAI adapter 当前有几条重要的容错逻辑：

- 流式请求被 relay 拒绝时，可以退回非流式完成请求。
- 非流式请求被 relay 拒绝时，可以退回流式请求并再聚合成统一 completion。
- 某些 relay 对 chat completions 不兼容时，可以退回 `Responses API`。
- 即使内部走了非流式 fallback，向上仍然可以合成统一的流式事件序列。

这点对 `Agent` 层很重要，因为 `Agent` 始终只消费 `stream()`。

### 5.3 OpenAI 映射范围

当前已经完成的映射主要包括：

- 统一消息 `<->` Chat Completions 消息
- 统一消息 `<->` Responses API input
- 工具 schema 映射
- 流式文本增量映射
- 工具调用增量映射
- 最终 completion 聚合
- HTTP / SDK 错误归一化

## 6. Anthropic 适配实现

Anthropic adapter 当前统一走 `Messages API`。

实现上做了几件核心事情：

- 把统一 `system` 消息折叠成 Anthropic 的 `system` 字段。
- 把统一 assistant `toolCalls` 映射成 `tool_use` block。
- 把统一 tool message 映射成 `tool_result` block。
- 把 SSE 事件归一化成统一 `AIStreamEvent`。
- 把 `stop_reason`、usage、provider headers 归一化成统一 completion。

Anthropic 当前没有像 OpenAI 那样复杂的多 transport fallback，整体链路更直接。

## 7. Agent 与 AI 的衔接方式

`package/agent` 当前只依赖统一 `AIClient` 接口。

实际闭环是：

1. `AgentRuntime` 调 `aiClient.stream()`
2. 消费统一 `AIStreamEvent`
3. 聚合 assistant 文本和工具调用
4. 发现工具调用后，交给外部 `toolExecutor`
5. 把工具结果回灌为统一 `tool` message
6. 再次调用 `aiClient.stream()`

也就是说：

- `AI` 层负责“把 provider 差异抹平”
- `Agent` 层负责“把模型调用和工具调用组织成 turn loop”

当前这个边界是清晰的，没有把 `AgentState`、UI 事件或 session 逻辑泄漏进 `AI` 层。

## 8. 当前真实支持的能力

今天已经能稳定工作的能力：

- 统一 `complete()` 调用
- 统一 `stream()` 调用
- `OpenAI + Anthropic` 双 provider
- 统一消息格式
- 统一工具调用结构
- 统一流式事件协议
- 统一错误模型
- 认证读取与配置覆盖
- 模型目录覆盖
- OpenAI relay 兼容 fallback
- `Agent` 层工具闭环集成

## 9. 当前只“定义了类型”，但还没有完整落地的选项

`AICallOptions` 现在对外暴露的字段比当前 adapter 真正接线的字段更多。

已明确接线的主要是：

- `tools`
- `temperature`
- `maxOutputTokens`
- `topP`
- `timeoutMs`
- `signal`
- `metadata` 的默认值合并

当前仍然更像“接口预留”而不是完整实现的字段包括：

- `toolChoice`
- `parallelToolCalls`
- `promptCacheKey`
- `promptCacheRetention`
- `reasoning`
- `output`
- `safetyIdentifier`
- `serviceTier`
- `store`
- `truncation`
- `userId`
- `verbosity`

这意味着当前上层如果传这些字段，多数情况下不会报错，但也不会被完整映射到 provider 请求里。现阶段应把这些字段看作预留接口，而不是已承诺能力。

## 10. 当前实现边界

当前有几个边界需要明确：

- `ModelCatalogEntry.capabilities` 目前主要是描述信息，还没有被严格当作运行时约束。
- 目前只支持 `OpenAI` 和 `Anthropic`。
- 还没有做自动模型选择、成本路由或 provider 级策略路由。
- 没有把 provider 的原生高级能力大规模透传给上层。
- `AIContext.metadata` 目前没有参与 provider 请求映射。

## 11. 测试状态

截至当前仓库状态，本地已验证：

- `npm test`
- `npm run typecheck`

测试覆盖到的重点包括：

- model catalog 覆盖与参数合并
- AI client 路由
- OpenAI complete / stream
- Anthropic complete / stream
- OpenAI relay fallback
- `AgentRuntime` 纯文本闭环
- `AgentRuntime` 工具调用闭环
- `AgentRuntime` 多工具串行执行
- `AgentRuntime` 超时 / 取消 / 限额停止
- `AgentRuntime` 与真实 HTTP 服务的集成路径

当前结果是：

- `typecheck` 通过
- `vitest` 31/31 通过

## 12. 对照规划文档的结论

如果只看 `MVP` 目标，当前 `AI` 层已经覆盖了规划文档里的核心闭环：

- 统一协议已建立
- provider adapter 已建立
- 模型目录已建立
- 认证与错误模型已建立
- `stream()` / `complete()` 两条主路径已打通
- 已经能支撑 `Agent` 层 turn loop

还没完全收口的地方主要不是主闭环，而是“对外类型面比当前真实实现更宽”。后续如果继续往上接 `Coding-Agent`，建议优先把这些预留字段分成两类：

- 真正准备支持并补齐 adapter 映射的
- 暂时不支持、应显式拒绝或从 public API 去掉的

这一步做完以后，`AI` 层的对外契约会更稳。
