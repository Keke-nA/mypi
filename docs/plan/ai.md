# AI 层细化计划

## 1. 目标

AI 层的目标是提供统一的大模型调用协议，屏蔽 `OpenAI` 和 `Anthropic` 在消息格式、工具调用、流式事件和认证方式上的差异。

这一层要让上层只关心三件事：

- 用哪个模型
- 传什么上下文
- 需要流式还是一次性完整返回

## 2. 职责边界

### 本层负责

- 定义统一的模型调用协议
- 定义统一的消息与工具 schema
- 实现 provider 路由与厂商 adapter
- 管理模型目录和能力声明
- 统一认证读取和错误模型

### 本层不负责

- Agent 状态机
- turn loop
- session tree
- 终端展示
- 工作区工具实现

### 上下游关系

- 上游使用方主要是 `Agent` 层和 `Coding-Agent` 层
- 下游依赖是具体的 provider SDK 或 HTTP 客户端
- 本层不能感知 `AgentState`、`TurnNode` 或 `UiEvent`

## 3. 公开接口

### `createAIClient(config)`

创建统一的 AI 客户端实例，内部负责 provider 路由、adapter 装配和认证读取。

### `stream(model, context, options)`

以流式方式请求模型，返回统一的流式事件序列。

### `complete(model, context, options)`

以一次性方式请求模型，返回统一的完整结果对象。

## 4. 关键类型

- `ModelRef`
  逻辑模型引用，描述调用方想使用的模型，不直接暴露厂商细节。
- `AIMessage`
  统一消息结构，至少覆盖 `system`、`user`、`assistant`、`tool`。
- `AIContext`
  本次调用的上下文容器，承载消息序列和必要附加信息。
- `AICallOptions`
  调用配置，承载流式开关、推理参数、工具开关、超时和取消信号。
- `AIStreamEvent`
  流式事件协议，统一文本增量、工具调用增量、结束事件和错误事件。
- `AICompletion`
  完整调用结果，统一最终消息、工具调用记录、结束原因和用量信息。
- `ToolSchema`
  模型可见的工具定义结构，用于统一工具声明格式。
- `ProviderAdapter`
  厂商适配器接口，封装消息映射、调用执行、错误转换和流式事件转换。
- `ModelCatalogEntry`
  模型目录项，描述模型 id、provider、能力声明和默认参数。

## 5. 运行流程

1. 调用方通过 `createAIClient(config)` 创建统一客户端。
2. 调用方传入 `model`、`context`、`options`。
3. `AI` 层根据 `ModelRef` 查询模型目录，解析目标 provider 和底层模型 id。
4. provider router 将请求交给对应的 `ProviderAdapter`。
5. adapter 把统一协议转换成 provider 原生协议，执行调用并接收返回。
6. adapter 将 provider 原生响应转换为统一的 `AIStreamEvent` 或 `AICompletion`。
7. 如发生错误，本层将错误规范化后向上抛出，不泄漏底层 SDK 的杂乱形态。

## 6. 当前测试配置

当前后续联调和验收默认使用的测试配置见：

- [测试配置](./test-config.md)

在当前阶段：

- `OpenAI` 路径使用中转地址进行测试
- `Anthropic` 仍保留在 `MVP` 计划中，但当前没有可用凭证，暂不作为实际联调前提

## 7. Todo

- [ ] 定义统一消息协议。
- [ ] 定义统一工具调用协议。
- [ ] 定义统一流式事件协议。
- [ ] 定义统一完成结果结构。
- [ ] 设计 `ModelRef` 的最小字段集合。
- [ ] 设计 `ModelCatalogEntry` 的 capability 字段。
- [ ] 明确模型目录的加载方式和覆盖顺序。
- [ ] 设计 provider router 的职责边界。
- [ ] 定义 `ProviderAdapter` 的最小接口。
- [ ] 定义 `OpenAI` adapter 的映射方案。
- [ ] 定义 `Anthropic` adapter 的映射方案。
- [ ] 设计认证读取规则。
- [ ] 设计显式配置覆盖环境变量的规则。
- [ ] 设计统一错误模型。
- [ ] 设计可安全重试的错误范围。
- [ ] 规定半程流式响应的错误处理边界。
- [ ] 规定原始 provider metadata 的透传边界。
- [ ] 设计取消信号和超时的统一语义。
- [ ] 补充单测计划。
- [ ] 补充集成验收场景。

## 8. 测试与验收

### 单测重点

- `OpenAI` 消息格式到统一消息协议的映射
- `Anthropic` 消息格式到统一消息协议的映射
- 工具调用协议的双向转换
- 流式事件归一化
- 认证读取和配置覆盖
- 错误转换和重试边界

### 集成验收场景

- 同一套上层调用代码在 `OpenAI` 和 `Anthropic` 之间切换，无需改变调用接口。
- 相同的工具定义能在两个 provider 下被统一表达和消费。
- 流式和非流式两种调用路径都能返回统一结构。

### 验收标准

- `stream(model, context, options)` 和 `complete(model, context, options)` 的接口语义在两个 provider 下保持一致。
- 上层不需要了解厂商原生消息格式也能完成调用。
- 认证错误、限流、超时和协议不支持等错误都能以统一形态暴露。

## 9. 当前非目标

- 一次性支持更多 provider
- 在 `MVP` 阶段引入复杂的成本优化路由
- 在 `MVP` 阶段引入模型自动选择策略
- 在 `MVP` 阶段暴露过多 provider 原生能力
