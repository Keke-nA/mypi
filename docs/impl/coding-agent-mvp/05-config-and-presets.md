# 05 Config And Presets

本阶段新增文件：

- `package/coding-agent/src/config/config.ts`

本阶段修改文件：

- `package/coding-agent/src/cli/main.ts`
- `package/coding-agent/src/ui/interactive-app.ts`
- `package/coding-agent/src/tools/workspace-tools.ts`
- `package/coding-agent/src/core/session-manager.ts`
- `package/coding-agent/src/index.ts`

## 目标

把 coding-agent 从“只能靠 CLI 参数临时启动”推进到“像 pi 一样从 `~/.mypi/agent/` 读取默认配置”的状态。

## 已实现配置位置

### 全局配置

- `~/.mypi/agent/config.json`
- `~/.mypi/agent/presets.json`

### 项目配置

- `<cwd>/.mypi/config.json`
- `<cwd>/.mypi/presets.json`

### 显式配置

- `--config <path>`

## 已实现加载顺序

当前 `mypi` 的启动配置解析顺序是：

1. 内置默认值
2. `~/.mypi/agent/config.json`
3. `<cwd>/.mypi/config.json`
4. `--config <path>` 指向的配置文件
5. `preset`（来自配置、`MYPI_PRESET`、`--preset`）
6. 环境变量
7. CLI flags

也就是：

- 配置文件提供默认值
- preset 在配置层之上做二次覆盖
- env 和 CLI 最终可以覆盖前面结果

## 当前支持的 config.json 字段

```json
{
  "openai": {
    "apiKey": "...",
    "baseUrl": "https://aixj.vip/v1",
    "model": "gpt-5.4"
  },
  "agent": {
    "thinkingLevel": "off",
    "uiMode": "tui",
    "tools": ["read", "write", "edit", "bash"],
    "sessionDir": "~/.mypi/agent/sessions",
    "continueRecent": false,
    "systemPromptAppend": "Extra instructions",
    "compaction": {
      "enabled": true,
      "thresholdPercent": 80,
      "reserveTokens": 16384,
      "keepRecentTokens": 20000,
      "retryOnOverflow": true,
      "showUsageInUi": true
    }
  },
  "preset": "implement"
}
```

### `tools` 支持两种写法

数组写法：

```json
{
  "agent": {
    "tools": ["read", "bash"]
  }
}
```

布尔开关写法：

```json
{
  "agent": {
    "tools": {
      "read": true,
      "write": false,
      "edit": true,
      "bash": false
    }
  }
}
```

## 当前支持的 presets.json 字段

```json
{
  "implement": {
    "provider": "openai",
    "model": "gpt-5.4",
    "baseUrl": "https://aixj.vip/v1",
    "thinkingLevel": "medium",
    "tools": ["read", "bash", "edit", "write"],
    "instructions": "You are in implementation mode.",
    "uiMode": "tui",
    "compaction": {
      "thresholdPercent": 80,
      "keepRecentTokens": 20000
    }
  }
}
```

## 已接入的产品行为

### CLI flags

新增：

- `--config <path>`
- `--preset <name>`
- `--print-config`
- `--resume`
- `--resume-latest`

当前启动语义：

- 不带 resume 参数时默认新建 session
- `continueRecent` 默认值已调整为 `false`
- `--resume` 进入当前项目 / 全部会话两级 scope selector
- `--resume-latest` 直接恢复最近 session
- `--session-file <path>` 打开指定 session 文件

### Runtime 命令

新增：

- `/config`

### TUI 展示

- status 区会显示当前 active preset（如果存在）
- status 区会显示当前 context usage（可配置关闭）
- 启动时如果 config/preset 有 warning，会以 notice 形式显示

## 当前限制

- preset 目前主要用于启动配置，不是完整的 session-persisted preset 子系统
- 还没做 `/preset` 运行时切换命令
- 还没做配置文件热重载
- 还没做 themes / extensions / auth.json 之类更完整的 agent-dir 能力
