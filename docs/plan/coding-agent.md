# Coding-Agent 层细化计划

补充说明：

- `session` 子系统已经单独拆成专题文档，见 `docs/plan/session/README.md`
- 本文档继续保留 `Coding-Agent` 总装层定位，不再展开 session 的所有细节算法

## 1. 目标

Coding-Agent 层的目标是组合 `AI`、`Agent`、`TUI` 三层能力，并加入 session tree、工作区工具和上下文组装逻辑，形成一个真正可用的 coding-agent CLI 雏形。

这一层是产品装配层，也是最接近最终用户体验的一层。

## 2. 职责边界

### 本层负责

- 装配 `AI`、`Agent`、`TUI`
- 管理 session tree 和本地持久化
- 实现工作区工具
- 组装 coding 任务上下文
- 提供分支恢复和分支摘要能力
- 定义 CLI 入口语义

### 本层不负责

- 重新定义底层模型调用协议
- 重新定义 Agent 状态机
- 在 `MVP` 阶段实现多 Agent 系统
- 在 `MVP` 阶段实现复杂权限系统

### 上下游关系

- 上游是 CLI 或未来的其它产品入口
- 下游依赖 `AI` 层、`Agent` 层、`TUI` 层以及本地文件系统 / shell
- 本层负责把 session、工具和终端交互装配起来，但不反向侵入下层边界

## 3. 公开接口

### `createCodingAgent(config)`

创建 coding-agent 实例，装配 session store、tool registry、Agent runtime 和 TUI。

### `run(prompt)`

在当前 session 上执行一次新的 turn。

### `resumeFromTurn(turnId, options)`

从任意历史 `turn` 恢复，创建新分支并继续执行。

### `summarizeBranch(branchHeadTurnId)`

对指定分支从分叉点到分支头部的内容生成模型摘要，用于后续选择性注入新分支上下文。

## 4. 关键类型

- `CodingAgentConfig`
  coding-agent 的初始化配置，包含模型配置、工作区根目录、session 路径、工具开关和 UI 配置。
- `Session`
  单个会话的根对象，承载会话元数据、当前分支和 head turn 引用。
- `TurnNode`
  turn 节点结构，记录输入、输出、工具调用、父指针和停止原因。
- `BranchRef`
  分支引用，标识某条分支的 head turn 和来源关系。
- `BranchSummary`
  分支摘要对象，承载摘要文本、来源 turn 范围、生成模型和生成时间。
- `WorkspaceContext`
  工作区上下文，描述当前 cwd、必要环境信息和本次允许注入的额外上下文。

## 5. 运行流程

1. 调用方通过 `createCodingAgent(config)` 创建实例。
2. `Coding-Agent` 初始化 session store、tool registry、Agent runtime 和 TUI。
3. 调用 `run(prompt)` 时，本层读取当前 session、组装消息上下文和可用工具。
4. 本层把统一上下文交给 Agent 执行 turn，并把事件映射成 `UiEvent` 给 TUI 渲染。
5. turn 完成后，本层把结果写入 session tree，更新当前 branch head。
6. 调用 `resumeFromTurn(turnId, options)` 时，本层从目标 turn 派生新分支。
7. 如果用户选择注入分支摘要，本层调用 `summarizeBranch(branchHeadTurnId)` 生成摘要，再作为标准化 `system` 消息注入新分支上下文。
8. 本层继续执行新的 turn，并在落盘时保持旧分支不变。

## 6. Todo

- [ ] 定义 `CodingAgentConfig`。
- [ ] 定义 `Session`。
- [ ] 定义 `TurnNode`。
- [ ] 定义 `BranchRef`。
- [ ] 定义 `BranchSummary`。
- [ ] 定义 `WorkspaceContext`。
- [ ] 设计 session 存储目录结构。
- [ ] 设计 session manifest 结构。
- [ ] 设计 turn 节点落盘结构。
- [ ] 设计 branch 与 head 的引用规则。
- [ ] 设计当前 session 的发现与恢复规则。
- [ ] 设计 `run()` 的上下文组装流程。
- [ ] 设计 `resumeFromTurn()` 的分支创建流程。
- [ ] 设计 `resumeFromTurn()` 的分支命名或标识规则。
- [ ] 设计 `summarizeBranch()` 的摘要生成流程。
- [ ] 设计摘要来源 turn 范围的计算规则。
- [ ] 设计摘要注入新分支的消息格式。
- [ ] 设计摘要生成失败时的回退策略。
- [ ] 设计工具注册中心。
- [ ] 设计 `read` 工具协议。
- [ ] 设计 `write` 工具协议。
- [ ] 设计 `edit` 工具协议。
- [ ] 设计 `bash` 工具协议。
- [ ] 设计工具审计记录结构。
- [ ] 设计工具执行权限边界。
- [ ] 设计工作区根目录约束。
- [ ] 设计 session 事件到 `UiEvent` 的映射。
- [ ] 设计 CLI 的最小命令语义。
- [ ] 设计新会话运行流程。
- [ ] 设计继续当前会话流程。
- [ ] 设计从指定 turn 恢复流程。
- [ ] 补充 session tree 单测计划。
- [ ] 补充分支恢复与摘要注入验收场景。

## 7. 测试与验收

### 单测重点

- session manifest 的读写
- turn 节点父指针关系
- 从旧 turn 创建新分支且不影响原分支
- 分支摘要范围计算
- 分支摘要注入消息格式
- 工具调用记录与审计记录落盘
- 当前 session 的恢复逻辑

### 集成验收场景

- 多 turn 会话可连续执行并正确更新 head turn。
- 从旧 turn 拉出新分支后，原分支保持不变。
- 用户选择注入摘要时，摘要能被生成并进入新分支上下文。
- `bash/read/write/edit` 四个工具能通过 Agent 编排进入完整闭环。
- TUI 能在运行过程中看到 session、branch 和 turn 的变化。

### 验收标准

- 能完成多 turn 会话、从旧 turn 拉新分支、保持旧分支不变、可选注入模型生成摘要。
- 工具实现位于 `Coding-Agent` 层，而不是 `Agent` 层。
- session tree、工具和 TUI 被装配为一个完整的 coding-agent 运行闭环。

## 8. 当前非目标

- 多 Agent 协作体系
- 自动全仓索引和重型检索系统
- 复杂权限审批系统
- GUI 或 Web 形态
- 在 `MVP` 阶段拆出独立 `tools` 包
