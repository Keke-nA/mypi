# pi-tui 简要说明

对应代码：

- `package/pi-tui`
- 包名：`@mariozechner/pi-tui`

这一层不是 `mypi` 的业务核心，而是复用的终端 UI 框架，所以这里只做简要说明。

---

## 1. 它在项目里的定位

`pi-tui` 提供的是：

- 终端组件系统
- 差分渲染
- 输入处理
- overlay / selector / editor 等交互能力

在 `mypi` 里的实际角色是：

> 给 `coding-agent` 提供可交互的 TUI 外壳。

也就是说，`coding-agent` 的 `InteractiveApp` 是基于它搭起来的，而不是自己从零写 ANSI 终端框架。

---

## 2. 它主要对外提供什么

从 `README` 和当前集成方式看，最重要的内容有：

- `TUI`
- `ProcessTerminal`
- `Text`
- `Editor`
- `SelectList`
- overlay 能力
- `CombinedAutocompleteProvider`
- `matchesKey()` / `Key`

这些已经足够支撑 `mypi` 当前的交互模式。

---

## 3. `mypi` 里是怎么用它的

主要在：

- `package/coding-agent/src/ui/interactive-app.ts`
- `package/coding-agent/src/ui/select-overlay.ts`
- `package/coding-agent/src/ui/session-selector-overlay.ts`
- `package/coding-agent/src/ui/session-tree-overlay.ts`
- `package/coding-agent/src/ui/theme.ts`

### 当前用到的核心能力

- 顶层 `TUI`
- `Text` 展示 header / status / transcript
- `Editor` 作为输入框
- overlay 做 session selector、tree navigator、model/thinking 选择器
- autocomplete 支持 slash command 和文件路径
- 键盘事件处理（如 `Ctrl+C`）

所以 `coding-agent` 的 TUI 不是直接操作 stdout，而是站在一个成熟终端 UI 框架之上。

---

## 4. 为什么复用它而不是自己写

因为 `pi-tui` 已经提供了几个很关键的基础能力：

- 差分渲染，减少闪烁
- synchronized output，保证终端更新原子性
- 输入框 / 编辑器组件
- overlay 机制
- 终端宽度约束和组件化 render 接口

这让 `mypi` 可以把注意力放在：

- session
- agent
- 工具
- 交互逻辑

而不是终端底层绘制。

---

## 5. 这一层在面试里该怎么讲

不需要展开太细。

比较合适的说法是：

> `pi-tui` 是项目复用的终端 UI 基础设施。`mypi` 自己没有重写底层 terminal renderer，而是在这个框架上搭了 `coding-agent` 的交互界面，包括 transcript、editor、session selector 和 tree overlay。业务核心不在 `pi-tui`，而在上层的 session 和 agent 逻辑。

---

## 6. 关键代码位置

- `package/pi-tui/README.md`
- `package/coding-agent/src/ui/interactive-app.ts`
- `package/coding-agent/src/ui/select-overlay.ts`
- `package/coding-agent/src/ui/session-selector-overlay.ts`
- `package/coding-agent/src/ui/session-tree-overlay.ts`
