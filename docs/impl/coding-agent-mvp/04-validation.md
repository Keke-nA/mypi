# 04 Validation

## 自动验证

已通过：

- `npm run build --workspace @mypi/coding-agent`
- `npm run test --workspace @mypi/coding-agent`

当前 coding-agent 测试覆盖：

- session manager
- session context
- session compaction
- session runtime
- workspace tools
- config loader / preset merge

## 真实 OpenAI 兼容 smoke

已通过：

```bash
printf '%s\n' '{"urls":["https://aixj.vip/v1"],"apiKey":"***","model":"gpt-5.4"}' \
  | npm run smoke:openai --workspace @mypi/coding-agent
```

smoke 已验证：

- 真实模型调用
- tool use
- session 落盘
- tree navigation
- branch summary
- compaction

## CLI one-shot

已通过：

```bash
npm run cli --workspace @mypi/coding-agent -- \
  --api-key '***' \
  --base-url 'https://aixj.vip/v1' \
  --model 'gpt-5.4' \
  --in-memory \
  --prompt 'Reply with exactly CLI_OK and nothing else.'
```

## Config-file startup smoke

已通过：

```bash
HOME=/tmp/some-home node package/coding-agent/dist/cli/main.js --print-config
HOME=/tmp/some-home node package/coding-agent/dist/cli/main.js --plain --in-memory --prompt 'Reply with exactly CONFIG_OK and nothing else.'
```

其中 `HOME=/tmp/some-home/.mypi/agent/config.json` 提供：

- apiKey
- baseUrl
- model
- thinkingLevel
- uiMode
- tools
- systemPromptAppend

## 后续建议

下一轮更适合做：

1. 真正拆 `ui/interactive-app.ts` 为多个子组件
2. 增加 `session selector`、`tree view`、`message renderer` 的独立文件
3. 增加 destructive actions confirmation
4. 增加 auto-compaction 与 overflow recovery
5. 做真正的 TUI smoke / headless integration test
