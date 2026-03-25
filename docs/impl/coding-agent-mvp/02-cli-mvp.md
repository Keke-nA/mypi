# 02 CLI MVP

本阶段落地文件：

- `package/coding-agent/src/cli/main.ts`
- `package/coding-agent/src/tools/workspace-tools.ts`
- `package/coding-agent/src/core/model-utils.ts`
- `package/coding-agent/src/core/system-prompt.ts`
- `package/coding-agent/src/core/summary-generators.ts`

## CLI MVP 做了什么

### 1. 最小产品入口

CLI 支持：

- `--api-key`
- `--base-url`
- `--model`
- `--prompt`
- `--session-dir`
- `--session-file`
- `--resume`
- `--resume-latest`
- `--config`
- `--preset`
- `--print-config`
- `--in-memory`

### 2. Session 命令

支持：

- `/config`
- `/session`
- `/new`
- `/sessions [--all]`
- `/resume [--all] [index|path]`
- `/delete [--all] [index|path|current]`
- `/tree`
- `/fork`
- `/compact`
- `/model`
- `/thinking`
- `/name`
- `/exit`

### 3. Workspace tools

实现了 coding-agent 层工具：

- `read`
- `write`
- `edit`
- `bash`

这些工具没有下沉到 `agent` 层，而是作为 product/runtime 层装配给 `Agent`。

### 4. Summary generators

接了真实 LLM 总结器：

- branch summary generator
- compaction summary generator

## 当前定位

这是一层最小可用 CLI，不是最终 `pi` 等级交互体验。

它解决的是：

- 真实对话可跑
- 真实工具可跑
- 真实 session 可持久化
- 默认启动进入新 session
- `--resume` / `--resume-latest` / `--session-file` 三种恢复入口可区分
- `--resume` 启动时会先进入 selector，不会先落一个空白新 session
- `/sessions` / `/resume` / `/delete` 在 plain CLI 里也支持 `--all`
- `/delete` 和 selector 内删除能力可用
- 真实 branch / fork / compact 可跑
