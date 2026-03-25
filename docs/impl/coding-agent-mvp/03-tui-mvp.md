# 03 TUI MVP

本阶段落地文件：

- `package/coding-agent/src/ui/theme.ts`
- `package/coding-agent/src/ui/select-overlay.ts`
- `package/coding-agent/src/ui/session-tree-overlay.ts`
- `package/coding-agent/src/ui/interactive-app.ts`

## TUI MVP 做了什么

### 1. 使用 `@mariozechner/pi-tui` 搭壳

采用的核心组件：

- `TUI`
- `ProcessTerminal`
- `Editor`
- `Text`
- `SelectList`
- `Overlay`

### 2. 主界面结构

当前主界面是：

- 顶部 header
- session / model / thinking / streaming 状态块
- transcript 区域
- 底部 editor

### 3. 输入体验

- 使用 `Editor` 作为主输入框
- 接了 slash command autocomplete
- 支持 editor history
- 支持 streaming 时禁用提交

### 4. Overlay 行为

当前 overlay 分两类：

- 继续用 `SelectList` 实现 `/sessions` / `/resume` / `/model` / `/thinking`
- 为 `/tree` 单独实现了专门的 `session-tree-overlay`

新的 `/tree` overlay 已支持：

- 全屏风格的 tree panel
- `Type to search` 搜索过滤
- 用 `├─` / `└─` / `│` 显示 branch 结构
- 高亮当前 leaf
- `←/→` 折叠和展开 subtree
- `tab` 切换“直接导航 / 导航并 summary”模式

### 5. Agent runtime 联动

TUI 直接绑定 `AgentSession`：

- 监听 `Agent` 事件刷新界面
- 把 slash commands 转成 session/runtime 操作
- 继续复用同一套 session tree / compact / fork / resume 语义

## 当前限制

这还是 MVP，不是最终 polished app：

- transcript 目前是文本块重绘，不是更细颗粒的消息组件树
- 还没有完整复刻 `pi` 那种多区块 layout / footer widget / mode line
- 还没有权限审批弹窗
- session selector 仍然是简单 selector，后续可以继续做成和 tree overlay 一样的专门视图

但这版已经是真正的 `pi-tui` 交互式 coding-agent，而不是 readline 壳。
