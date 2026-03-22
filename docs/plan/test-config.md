# 测试配置

## 1. 文档定位

这份文档用于固定当前阶段后续联调、验收和手工测试默认使用的 provider 测试配置。

当前这些值按项目内部测试基线记录在文档中，后续若有更新，应直接修改本文件并同步引用它的其它计划文档。

## 2. 当前可用配置

### OpenAI 中转

- Base URL: `https://aixj.vip/v1`
- API Key: `sk-891bb084b4992a59f4b4dfe4dd902c9d3da0006d28e5c1a1e2a9ee7ff7b7b98a`

建议统一按下面的环境变量命名使用：

```bash
OPENAI_BASE_URL=https://aixj.vip/v1
OPENAI_API_KEY=sk-891bb084b4992a59f4b4dfe4dd902c9d3da0006d28e5c1a1e2a9ee7ff7b7b98a
```

## 3. 当前缺失配置

### Anthropic

- 当前暂无可用的 Base URL 和 API Key
- 计划层仍保留 `Anthropic` 适配目标
- 实际联调、冒烟测试和验收时，默认先使用 `OpenAI` 路径

## 4. 使用约定

- 后续测试若未特别说明，默认使用本文件中的 `OpenAI` 中转地址和 API Key。
- `AI` 层在实现认证读取时，优先兼容本文件中给出的 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。
- 在 `Anthropic` 凭证补齐之前，不要求 `MVP` 验收依赖 Anthropic 的真实线上联调。

## 5. 后续维护规则

- 如果更换中转地址或 Key，直接更新本文件，不在多个计划文档中重复写值。
- 其它计划文档只引用本文件，不再复制具体凭证内容。
