# AI 层当前实现说明

## 1. 当前定位

当前 `package/ai` 已经收敛成一条 **OpenAI official only** 的主线实现。

目标不是“统一多 provider”，而是先把下面这套协议和运行时骨架定稳：

- `getModel(provider, modelId)`
- `stream(model, context, options)`
- `complete(model, context, options)`
- `streamSimple(model, context, options)`
- `completeSimple(model, context, options)`

核心不变量已经成立：

- `complete(...) === await stream(...).result()`
- `completeSimple(...) === await streamSimple(...).result()`

对应实现见：

- [stream.ts](/home/gao-wsl/mypi/package/ai/src/stream.ts)
- [utils/event-stream.ts](/home/gao-wsl/mypi/package/ai/src/utils/event-stream.ts)

## 2. 当前目录结构

当前 `src/` 顶层已经收敛到 8 个文件：

- `api-registry.ts`
- `config.ts`
- `env-api-keys.ts`
- `index.ts`
- `models.generated.ts`
- `models.ts`
- `stream.ts`
- `types.ts`

辅助实现分两层：

- `providers/`
  只保留 OpenAI Responses 主线
- `utils/`
  事件流、partial JSON、校验、TypeBox helper 等通用能力

## 3. 协议

统一协议都在 [types.ts](/home/gao-wsl/mypi/package/ai/src/types.ts)。

主要类型：

- `Model`
  静态模型描述，包含 `api / provider / baseUrl / reasoning / input / cost / contextWindow / maxTokens`
- `Context`
  会话上下文，包含 `systemPrompt / messages / tools`
- `Message`
  `user / assistant / toolResult`
- `AssistantMessage`
  可回放的会话状态对象，不是 UI 展示对象
- `AssistantMessageEvent`
  `start / text_* / thinking_* / toolcall_* / done / error`
- `Usage`
  token 与成本
- `StopReason`
  `stop / length / toolUse / error / aborted`

这套结构是按“可序列化、可回放、可继续放回 context”设计的。

## 4. 运行方式

### 4.1 模型

模型注册在：

- [models.generated.ts](/home/gao-wsl/mypi/package/ai/src/models.generated.ts)
- [models.ts](/home/gao-wsl/mypi/package/ai/src/models.ts)

当前只内置 OpenAI official 模型元数据，并暴露：

- `getModel()`
- `getModels()`
- `getProviders()`
- `calculateCost()`

### 4.2 Provider 路由

provider 注册表在：

- [api-registry.ts](/home/gao-wsl/mypi/package/ai/src/api-registry.ts)

内建注册在：

- [providers/register-builtins.ts](/home/gao-wsl/mypi/package/ai/src/providers/register-builtins.ts)

当前只注册：

- `openai-responses`

### 4.3 OpenAI 路径

OpenAI Responses provider 主要在：

- [providers/openai-responses.ts](/home/gao-wsl/mypi/package/ai/src/providers/openai-responses.ts)
- [providers/openai-responses-shared.ts](/home/gao-wsl/mypi/package/ai/src/providers/openai-responses-shared.ts)

它负责：

- 认证与 fetch/runtime 配置读取
- Context -> OpenAI Responses payload
- Tool schema -> OpenAI tool schema
- SSE/SDK stream -> `AssistantMessageEvent`
- usage / stopReason / cost 归一化

### 4.4 配置

运行时配置集中在：

- [config.ts](/home/gao-wsl/mypi/package/ai/src/config.ts)

当前支持：

- `configureAI(config)`
- `getAIConfig()`

主要用来注入：

- `providers.openai.apiKey`
- `providers.openai.baseUrl`
- `providers.openai.defaultHeaders`
- `fetch`
- `env`

## 5. 辅助能力

### TypeBox / schema helper

导出：

- `Type`
- `Static`
- `TSchema`
- `StringEnum`

实现见：

- [index.ts](/home/gao-wsl/mypi/package/ai/src/index.ts)
- [utils/typebox-helpers.ts](/home/gao-wsl/mypi/package/ai/src/utils/typebox-helpers.ts)

### Tool 参数验证

使用 AJV + TypeBox：

- [utils/validation.ts](/home/gao-wsl/mypi/package/ai/src/utils/validation.ts)

导出：

- `validateToolCall`
- `validateToolArguments`

### EventStream

带 `result()` 的流对象在：

- [utils/event-stream.ts](/home/gao-wsl/mypi/package/ai/src/utils/event-stream.ts)

### Streaming partial JSON

tool 参数的 partial JSON 解析在：

- [utils/json-parse.ts](/home/gao-wsl/mypi/package/ai/src/utils/json-parse.ts)

## 6. 当前满足的设计点

对照 `notes/ai-layer-architecture/read.md`，当前已经满足得比较好的部分：

- 对外 API 形状清楚
- `complete === await stream.result()`
- 输入输出协议独立
- `AssistantMessage` 可回放、可序列化
- `streamSimple / completeSimple` 已经落地
- provider 差异被封装在 adapter 内部
- Model 与 Options 已分离
- tool 参数验证已落地

## 7. 当前还没做的

当前明确未做或未完成：

- 多 provider
- cross-provider handoff
- 浏览器/OAuth/CLI 相关能力
- 更完整的模型注册表
- 更完整的不变量测试集合

也就是说，当前这层已经是一个更干净的骨架，但还不是 `pi-ai` 全量复刻版。

## 8. 测试

当前 `package/ai/test` 只保留新主线测试：

- [sdk.test.ts](/home/gao-wsl/mypi/package/ai/test/sdk.test.ts)

覆盖内容：

- `getModel()` 元数据
- `complete()` + tool call
- `streamSimple()` 的 text / thinking / toolcall 事件
- `validateToolCall()`

本轮已实际验证：

```bash
npm run build --workspace @mypi/ai
npm test --workspace @mypi/ai
```

## 9. 当前结论

现在的 `package/ai` 已经不再是“旧低层栈 + 新高层栈并存”的状态，而是：

```text
一套 OpenAI-only、pi 风格、协议优先的 AI 层骨架
```

如果下一步继续做，最合理的方向不是再扩散文件，而是：

1. 把不变量测试补完整
2. 再决定是否扩多 provider
3. 如果扩 provider，也继续沿这套骨架加，不再回到旧的双轨结构
