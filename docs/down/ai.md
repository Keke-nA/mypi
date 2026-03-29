# AI 层说明

对应代码：

- `package/ai/src`
- 包名：`@mypi/ai`

---

## 0. 最小使用方式

`ai` 层是一个库，不是单独的 CLI。最简单的使用方式是在代码里直接调用。

最小示例：

```ts
import { configureAI, completeSimple, getModel } from "@mypi/ai";

configureAI({
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  },
});

const model = getModel("openai", "gpt-5.4");
const result = await completeSimple(model, {
  systemPrompt: "You are a concise assistant.",
  messages: [
    {
      role: "user",
      content: "Explain what this project does.",
      timestamp: Date.now(),
    },
  ],
});

console.log(
  result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(""),
);
```

如果你想消费流式事件，而不是只拿最终结果，就改用：

- `stream(...)`
- `streamSimple(...)`

这层的实际使用者通常不是最终用户，而是：

- `@mypi/agent`
- `@mypi/coding-agent`
- `@mypi/mom`

---

## 1. 这一层是干什么的

`ai` 层是整个项目最底层的“模型调用协议层”。

它的职责不是做 Agent，也不是做 session，更不是做 UI。它只负责一件事：

> 把“给模型发上下文、拿模型回复、消费流式事件”这件事统一起来。

当前 `mypi` 的 `ai` 实现已经从只支持 OpenAI，扩到两条官方主线：

- OpenAI Responses API
- Anthropic Messages API

所以今天这层更准确的定位是：

```text
一套以 OpenAI / Anthropic 为核心的统一模型调用层
```

---

## 2. 这一层对外提供什么

### 核心调用函数

入口在：`package/ai/src/index.ts`

当前最重要的对外函数有：

- `getModel(provider, modelId)`
- `getModels(provider)`
- `getProviders()`
- `calculateCost(model, usage)`
- `configureAI(config)`
- `getAIConfig()`
- `stream(model, context, options)`
- `complete(model, context, options)`
- `streamSimple(model, context, options)`
- `completeSimple(model, context, options)`

其中最重要的是后四个。

### 一个关键不变量

当前代码明确建立了这个关系：

- `complete(...) === await stream(...).result()`
- `completeSimple(...) === await streamSimple(...).result()`

也就是说：

- 既可以当普通 completion API 用
- 也可以当统一事件流 API 用

上层最终主要消费的是 **streaming 语义**。

---

## 3. 核心数据结构

这些都在：`package/ai/src/types.ts`

### `Model`
描述模型元数据，包括：

- `id`
- `name`
- `api`
- `provider`
- `baseUrl`
- `reasoning`
- `input`
- `cost`
- `contextWindow`
- `maxTokens`

它不是一次请求，而是“静态模型定义”。

### `Context`
模型调用上下文，包含：

- `systemPrompt?`
- `messages`
- `tools?`

### `Message`
当前统一支持三类会话消息：

- `user`
- `assistant`
- `toolResult`

### `AssistantMessage`
这是最关键的可持久化对象之一。

它不是简单字符串，而是带结构的 assistant 结果，包含：

- `content`
  - `text`
  - `thinking`
  - `toolCall`
- `usage`
- `stopReason`
- `errorMessage?`
- `provider / api / model`

这让上层可以：

- 持久化会话
- 重放上下文
- 在后续 turn 中继续使用历史 assistant 输出

另外，现在对“中途中断的 assistant”也有一条明确语义：

- 如果流式输出过程中已经产出了可见文本，最终 `AssistantMessage` 仍会保留这部分 `text`
- 到下一轮真正发给模型前，`ai` 层会把这类 `stopReason = error/aborted` 的 assistant **降级为仅包含 text 的 assistant message** 参与重放
- 不会重放其中未完成的 `thinking` / `toolCall`，避免 provider API 因不完整中间态报错

所以这里支持的是：

> “保留用户已经看到的 partial assistant 文本，并在下一轮继续基于它往下生成”

而不是网络层面的流断点续传。

### `AssistantMessageEvent`
统一流式事件协议。

当前事件包括：

- `start`
- `text_start / text_delta / text_end`
- `thinking_start / thinking_delta / thinking_end`
- `toolcall_start / toolcall_delta / toolcall_end`
- `done`
- `error`

所以这层不仅能给最终结果，也能把“文本增量 / 思考增量 / 工具调用增量”逐步向上游推送。

---

## 4. 这一层的架构

可以把 `ai` 层理解成三块：

```text
模型注册
   +
provider 注册
   +
统一事件流协议
```

### 4.1 模型注册

代码位置：

- `package/ai/src/models.generated.ts`
- `package/ai/src/models.ts`

当前通过 `MODELS` 建立 provider -> model registry，然后提供：

- `getModel()`
- `getModels()`
- `getProviders()`

当前内建模型已经覆盖：

- OpenAI Responses 主线模型
- Anthropic Messages 主线模型（如 `claude-sonnet-4-5`、`claude-opus-4-6`）
- 一个内建的 Anthropic-compatible Kimi 模型：`kimi-k2.5`

因此上层不会自己拼某个 provider 的 endpoint 或 pricing，而是先拿一个标准化 `Model` 对象。

另外，上层如果指定的是“已知 provider，但 registry 里还没有的 model id”，`coding-agent` 这层也已经支持按 provider 构造兼容模型对象继续运行，所以内建 registry 和兼容兜底两条路径现在是并存的。

### 4.2 provider 注册

代码位置：

- `package/ai/src/api-registry.ts`
- `package/ai/src/providers/register-builtins.ts`

当前注册表把 `api` 映射到真正的 provider 实现。

当前内建有两个：

- `openai-responses`
- `anthropic-messages`

所以今天这层虽然保留了“可注册 provider”的骨架，但实际运行路径已经明确收敛在两条官方 API 上：

```text
OpenAI Responses API
Anthropic Messages API
```

### 4.3 流式事件流

代码位置：

- `package/ai/src/utils/event-stream.ts`

`EventStream<T, R>` 是一个很关键的小抽象：

- 它本身是 `AsyncIterable<T>`
- 同时还支持 `result(): Promise<R>`

这意味着一条流既可以：

- 被 `for await` 消费事件
- 又可以在结束后直接拿最终结果

`AssistantMessageEventStream` 就是专门给 assistant 流式输出准备的版本。

这是 `agent` 层能简单消费模型流式回复的基础。

---

## 5. 当前实际运行链路

今天 `ai` 层的实际主链路是：

```text
上层传入 Model + Context + Options
  -> streamSimple()/completeSimple()
  -> 通过 api registry 找到目标 provider
  -> 把统一 Context 映射为 provider payload
  -> 调用 OpenAI SDK / Anthropic SDK / fetch
  -> 把返回流重新归一化为 AssistantMessageEvent
  -> 最终聚合成 AssistantMessage
```

当前关键文件：

- `stream.ts`
- `providers/openai-responses.ts`
- `providers/openai-responses-shared.ts`
- `providers/anthropic.ts`

---

## 6. 配置体系

代码位置：`package/ai/src/config.ts`

### 对外提供

- `configureAI(config)`
- `getAIConfig()`
- `resolveOpenAIConfig(...)`
- `resolveAnthropicConfig(...)`

### 当前支持的运行时配置

主要是：

- `providers.openai.apiKey`
- `providers.openai.baseUrl`
- `providers.openai.defaultHeaders`
- `providers.anthropic.apiKey`
- `providers.anthropic.baseUrl`
- `providers.anthropic.defaultHeaders`
- `fetch`
- `env`

也就是说，这层允许上层：

- 指定 API key
- 指定 baseUrl
- 注入 fetch
- 在不同运行环境下切换配置来源

这一点让 `coding-agent` 和 `mom` 都能在上层控制模型接入，而不用直接碰 provider 细节。

---

## 7. 为什么这一层重要

因为它给上层建立了一个非常稳定的边界：

### 上层只需要知道

- 用哪个 `Model`
- 提供什么 `Context`
- 要不要工具、thinking、maxTokens 等选项

### 上层不需要知道

- OpenAI / Anthropic 请求具体长什么样
- SSE/SDK 事件怎么拼
- usage/cost 怎么回填
- tool call 的 partial JSON 怎么聚合

这让 `agent` 层可以完全站在统一协议上工作。

---

## 8. 当前这层没有负责什么

这一层明确**不负责**：

- tool 真正执行
- 单 Agent turn loop
- 会话持久化
- branch / fork / summary
- workspace tools
- Slack transport
- TUI

所以如果面试官问“这层是不是就是 Agent 本体”，答案是否定的。

它只是：

> “模型调用与事件协议层”。

---

## 9. 当前状态下可以怎么评价这层

如果用一句偏面试的说法，我会这么介绍：

> `@mypi/ai` 是一个协议优先的 AI runtime layer。它把模型元数据、provider 注册、流式事件协议和最终 completion 聚合统一起来，对上层只暴露 `Model + Context + EventStream` 这组稳定抽象。当前实现已经内建 OpenAI Responses 与 Anthropic Messages 两条官方主线，因此既保留了结构上的干净边界，也开始具备多 provider 的实际可用性。

---

## 10. 当前限制

当前代码状态下，这层的边界也很明确：

- 当前只内建 `openai-responses` 与 `anthropic-messages`
- 还没有更复杂的多 provider 路由策略
- 没做 provider 级自动切换 / fallback
- 没做 session
- 没做工具执行
- 没做产品级配置和 UI

也正因为边界清楚，这层反而比较适合作为“可复用底座”。

---

## 11. 关键代码位置

- `package/ai/src/types.ts`
- `package/ai/src/stream.ts`
- `package/ai/src/models.ts`
- `package/ai/src/config.ts`
- `package/ai/src/api-registry.ts`
- `package/ai/src/providers/openai-responses.ts`
- `package/ai/src/providers/anthropic.ts`
- `package/ai/src/utils/event-stream.ts`
