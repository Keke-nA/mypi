# Prompt sync with pi-mono (2026-03-29)

## 背景

`pi-mono` 当前的 coding-agent prompt 在结构和工具说明上比 `mypi` 更完整；`mypi` 之前的 prompt 更偏“仓库内编码助手”，工具用法和运行环境说明都更简略。

## 本次同步内容

### 1. coding-agent system prompt

把 `mypi` 的基础 coding prompt 调整为更接近 `pi-mono` 的语气和结构：

- 明确声明自己是运行在 coding harness 里的 coding assistant
- 明确列出 `read / bash / edit / write` 工具
- 明确说明 `bash` 可以用于 `ls / rg / find / jq / curl / build / test`

### 2. mom system prompt

把 `mom` 的 prompt 结构也往 `pi-mono` 靠拢，同时保留 `mypi` 自己的运行时约束：

- 增加 Slack `mrkdwn` 格式说明
- 增加更完整的 runtime / workspace / log query / tools 说明
- 保留 docker sandbox 下 host path -> sandbox path 的转换要求
- 保留 workspace `settings.json` 的 prompt append 注入
- 保留 `[SILENT]` 语义说明

## 结果预期

这次改动只调整 prompt 内容，不改工具实现。

注：本次同步不再额外加入“外部信息一律主动用 shell/HTTP 查询”这类 `pi-mono` 源码里没有的硬性约束。

预期效果：

- `mypi` 的基础 coding-agent prompt 更接近 `pi-mono` 当前的工具说明和语气
- `mom` 在 Slack 场景下也会继承同样的结构化说明，同时继续遵守 sandbox 路径和 Slack 输出格式约束

## 涉及文件

- `package/coding-agent/src/core/system-prompt.ts`
- `package/coding-agent/test/system-prompt.test.ts`
- `package/mom/src/agent.ts`
- `package/mom/test/settings-and-silent.test.ts`
