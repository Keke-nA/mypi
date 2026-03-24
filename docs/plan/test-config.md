# 测试配置

## 1. 文档定位

这份文档用于固定当前阶段后续联调、验收和手工测试默认使用的 provider 测试配置。

当前这些值按项目内部测试基线记录在文档中，后续若有更新，应直接修改本文件并同步引用它的其它计划文档。

## 2. 当前可用配置

### OpenAI 中转

- Base URL: `https://aixj.vip/v1 如果不通就 https://aixj.vip`
- API Key: `sk-426b195e07ceeda2164b5bc151b6a314c84509272375039c44af3456457781dd`

建议统一按下面的环境变量命名使用：

```bash
OPENAI_BASE_URL=https://aixj.vip/v1
OPENAI_API_KEY=sk-426b195e07ceeda2164b5bc151b6a314c84509272375039c44af3456457781dd
```

当前建议默认联调模型：

```bash
OPENAI_MODEL=gpt-5.4
```

可直接使用现有 smoke 脚本进行手工联调：

```bash
printf '%s\n' '{"urls":["https://aixj.vip/v1"],"apiKey":"'"$OPENAI_API_KEY"'","model":"gpt-5.4"}' \
  | npm run smoke:openai --workspace @mypi/ai
```

如需直接验证 `agent + ai` 的完整链路，可使用：

```bash
printf '%s\n' '{"urls":["https://aixj.vip/v1"],"apiKey":"'"$OPENAI_API_KEY"'","model":"gpt-5.4","retries":5,"delayMs":1000}' \
  | npm run smoke:openai --workspace @mypi/agent
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
