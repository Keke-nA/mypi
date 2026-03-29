# Mom 进度记录（一）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 复现工作的前两轮落地结果，重点覆盖：

- 已新增的包与文件
- 已打通的运行链路
- 当前可直接联调的能力
- 尚未完成的能力
- 当前联调中已经观察到的行为

---

## 1. 本轮目标

本阶段目标不是一次性完整复刻 `pi-mono/packages/mom`，而是先在 `mypi` 现有 `OpenAI + Agent + AgentSession` 基础上，打通最小可运行的 `mom` 外层 harness。

约束如下：

- 保留 `OpenAI-compatible` provider
- 暂不实现 `Anthropic` / `/login` / `auth.json`
- 先把 Slack 文本消息、per-channel workspace、context 持久化、sandbox、基础工具闭环跑通

---

## 2. 第一轮完成内容

### 2.1 新增 `package/mom`

已新增：

- `package/mom/package.json`
- `package/mom/tsconfig.json`
- `package/mom/tsconfig.build.json`
- `package/mom/src/index.ts`
- `package/mom/src/main.ts`
- `package/mom/src/slack.ts`
- `package/mom/src/store.ts`
- `package/mom/src/context.ts`
- `package/mom/src/agent.ts`
- `package/mom/src/log.ts`

### 2.2 已打通的基础链路

已实现：

- Slack Socket Mode 接入
- Web API client 接入
- DM / `@mention` 触发
- per-channel queue
- `stop` 中断
- `log.jsonl` 落盘
- `context.jsonl` 同步未见用户消息
- 复用 `@mypi/coding-agent` 的 `AgentSession`
- 复用 `SessionManager` 固定写入 `context.jsonl`
- workspace / channel `MEMORY.md` 注入 system prompt

### 2.3 第一轮后的能力边界

第一轮完成后，`mom` 已具备最小文本对话能力，但仍未具备：

- sandbox
- mom 专用工具层
- Slack 文件回传
- 附件输入链路
- tool 线程日志
- skills
- events
- usage summary

---

## 3. 第二轮完成内容

### 3.1 新增 sandbox 与工具层

已新增：

- `package/mom/src/sandbox.ts`
- `package/mom/src/tools/index.ts`
- `package/mom/src/tools/truncate.ts`
- `package/mom/src/tools/read.ts`
- `package/mom/src/tools/write.ts`
- `package/mom/src/tools/edit.ts`
- `package/mom/src/tools/bash.ts`
- `package/mom/src/tools/attach.ts`

### 3.2 已实现的运行时能力

已实现：

- `--sandbox=host`
- `--sandbox=docker:<name>`
- sandbox 参数解析与校验
- host executor
- docker executor
- `/workspace` 到 host 工作区路径映射
- `read` / `write` / `edit` / `bash` / `attach`
- 工具统一 `label` 参数
- 工具统一支持 `AbortSignal`
- Slack 文件回传 `uploadFile`
- `attach` 工具上传文件到 Slack
- `read` 工具支持图片文件作为模型可读结果

### 3.3 第二轮后的能力边界

第二轮完成后，`mom` 已能在 Slack 中做最小工具型对话，但仍未具备：

- Slack 附件下载输入链路
- tool 线程日志
- backfill
- skills
- events
- usage summary

---

## 4. 当前已经可用的能力

截至本文记录时，下面这些能力已经可以尝试联调：

### 4.1 Slack 基本交互

- DM 机器人
- channel 中 `@mention`
- `stop` 中断当前任务

### 4.2 持久化与上下文

- 每个 channel / DM 独立目录
- `log.jsonl` 记录用户消息与 bot 回复
- `context.jsonl` 累积 Agent 上下文
- 同一会话中前文可继续被后文引用

### 4.3 工具能力

- `read`
- `write`
- `edit`
- `bash`
- `attach`

### 4.4 sandbox

- host 模式可运行
- docker 模式启动逻辑已具备

---

## 5. 当前联调结果

本轮已经完成一次最小联调，观察到：

### 5.1 启动成功

可通过下面命令启动：

```bash
node package/mom/dist/main.js --sandbox=host ~/mypi/.mom-data
```

启动日志显示：

- `Starting mom`
- `Slack bot connected`

说明：

- 构建已成功
- Slack 连接已成功
- 运行时主入口已可工作

### 5.2 Slack 文本对话成功

已观察到：

- 发送 `你好`，bot 正常回复
- 发送 `remember that our repo root is /workspace`
- 再问 `what did i just tell you?`
- bot 能正确复述先前内容

说明：

- DM / mention 通道正常
- `log.jsonl -> context.jsonl` 同步逻辑生效
- session 持久化与上下文继续使用已生效

### 5.3 工具调用成功

已观察到：

- `run pwd and tell me where you are`
- bot 能调用 `bash` 并返回当前目录

说明：

- 工具注册与执行链路已经打通
- `mom -> Agent -> Tool -> Slack` 的主闭环已经可用

### 5.4 当前一个已知现象

联调中还观察到一个合理现象：

用户先让 bot “记住 repo root 是 `/workspace`”，随后又在 `host` 模式下要求它写文件，bot 返回：

- 无法创建 `/workspace`
- 权限被拒绝

这个现象本身不是 bug，而是当前运行模式和记忆内容冲突导致：

- `host` 模式下真实工作目录是类似 `/home/gao-wsl/mypi/.mom-data`
- `/workspace` 只在 `docker` 模式下才是正确语义

因此：

- 如果使用 `host` 模式，就不要把 repo root 固定记成 `/workspace`
- 如果希望 bot 始终以 `/workspace` 作为工作区语义，应切换到 `docker` 模式

---

## 6. 当前建议的使用方式

### 6.1 如果继续使用 host 模式

建议直接让 bot 操作：

- 相对路径，例如 `hello.txt`
- 当前工作区内路径
- `~/mypi/.mom-data` 下的真实路径

不建议在 memory 中告诉它根目录是 `/workspace`。

### 6.2 如果要更接近上游 mom

建议切到 docker 模式：

```bash
mkdir -p ~/mypi/.mom-data
docker run -d \
  --name mymom-sandbox \
  -v ~/mypi/.mom-data:/workspace \
  alpine:latest \
  tail -f /dev/null

node package/mom/dist/main.js --sandbox=docker:mymom-sandbox ~/mypi/.mom-data
```

这样：

- bot 的工作区路径就是 `/workspace`
- 与上游 mom 的工作方式更接近
- path 语义更统一

---

## 7. 当前仍待完成的能力

下面这些仍然是后续重点：

### 7.1 输出可观测性

还未实现：

- tool 线程日志
- tool 参数 / 结果 / 错误的线程展示
- usage summary

### 7.2 工作区增强能力

还未实现：

- `skills/` 扫描与注入
- `SYSTEM.md` 维护约定
- workspace `settings.json`

### 7.3 长期运行能力

还未实现：

- backfill
- `events/` watcher
- `immediate`
- `one-shot`
- `periodic`
- `[SILENT]`

---

## 8. 当前状态总结

可以把当前状态定义为：

**“最小可运行 mom 联调版”**

已经具备：

- Slack 接入
- 文本对话
- 上下文继续使用
- 同一窗口 follow-up 顺序处理
- 基础工具调用
- host / docker sandbox 启动路径
- 文件回传到 Slack
- Slack 附件下载输入链路
- 图片作为模型输入
- 非图片附件路径注入 prompt / context

但还不具备完整 mom 体验中的：

- 工具线程日志
- skills
- events
- backfill
- usage summary

---

## 9. 本阶段验证结果

已完成验证：

- `npm install`
- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 实际启动 `mom`
- Slack 成功连接
- 文本对话成功
- 记忆 / 上下文延续成功
- `bash` 工具调用成功
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本轮 `mom` 改动无关

未完成验证：

- Slack 上传图片 / 文件后的实机 smoke test
- `attach` 实际上传更多复杂文件类型
- docker 模式实测工具全链路
- events
- skills

---

## 10. 下一步建议

建议按下面优先级继续推进：

1. tool 线程日志
2. backfill
3. events
4. skills
5. usage summary

其中最优先建议是：

**先做 tool 线程日志**

因为附件输入链路已经打通，下一步最缺的是：

- 看到每个工具到底做了什么
- 在 Slack thread 里查看参数、结果和错误
- 让长任务更容易调试

---

## 11. 第三轮补充：同窗口 follow-up 顺序处理

在前两轮实现里，同一个 channel / DM 正在运行时，如果新消息继续进入，处理方式是：

- 先记入 `log.jsonl`
- 直接提示 `Already working`
- 不在当前 run 内继续处理

这一版已经改成：

- 同一窗口运行中来的后续消息，不再直接 busy 拒绝
- 改为走 `Agent.followUp()`
- follow-up 模式固定为 `one-at-a-time`
- 因此消息 2、3 会按顺序接在同一 runner 后面继续处理
- 每条消息仍会各自得到一条 Slack 回复
- 每条消息对应的 bot 回复仍会分别写入该 channel 的 `log.jsonl`

这一步的意义是：

- 更贴近你直觉里的“同一个窗口继续说话，bot 继续顺着处理”
- 不需要等当前 run 完全结束后，再手动触发下一次 run
- `mom` 已经开始真正利用 `@mypi/agent` 内部的消息追加能力，而不是只靠外层 busy 判断

当前语义更准确地说是：

- 同一窗口：顺序处理
- 不同窗口：彼此独立
- 同一窗口内运行中新增消息：优先走 follow-up
- 如果消息到达时本轮 run 刚好已经结束，则回退成下一次普通 run

---

## 12. 第四轮补充：附件输入链路

这一轮已经把“Slack 上传附件给 mom”这条输入链路接上了。

### 12.1 这轮具体补了什么

已完成：

- `store.ts` 支持附件元数据登记
- `store.ts` 支持后台下载 Slack 附件到 `<channel>/attachments/`
- `store.ts` 支持等待附件下载完成后再交给 runner
- `slack.ts` 支持读取 Slack 事件里的 `files`
- `slack.ts` 支持“只有附件没有文本”的消息进入链路
- `slack.ts` 会把附件信息写进 `log.jsonl`
- `main.ts` 已向 runner 暴露 `resolveAttachments()`
- `agent.ts` 会在当前消息和 follow-up 消息里注入附件
- `context.ts` 会在 `log.jsonl -> context.jsonl` 同步时保留附件信息

### 12.2 现在附件是怎么进模型的

当前策略分成两类：

#### 图片附件

- 先下载到本地工作区
- 再转成 image content
- 直接进入模型输入

这意味着现在可以开始测试：

- 上传报错截图
- 上传界面截图
- 上传图片后直接问 bot 这张图里是什么

#### 非图片附件

- 同样先下载到本地工作区
- 不直接转 image content
- 而是把相对路径写进 prompt / context 中的 `<slack_attachments>` 区块

例如会变成类似：

```text
<slack_attachments>
D123456/attachments/1712345678000_error.log
D123456/attachments/1712345679000_config.json
</slack_attachments>
```

这样 agent 后续就可以再通过 `read` 工具去读取这些文件。

### 12.3 这一步的意义

这一步之后，`mom` 不再只是一个“文本 bot”，而开始具备：

- 看 Slack 图片的能力
- 读取 Slack 文件的能力
- 把用户上传的文件和本地 workspace 连起来的能力
- 重启后从 `log.jsonl` / `context.jsonl` 恢复附件上下文的能力

也就是说，`mom` 已经从：

- 能聊天
- 能跑工具

继续推进到：

- 能围绕 Slack 里的真实附件工作

---

## 13. 一句话结论

截至本次记录点，`mypi` 中的 `mom` 已经从“纯规划状态”进入“可实际连上 Slack，并在同一窗口内顺序处理多条消息、完成最小对话、工具调用和附件输入的可运行状态”，后续重点将从“能启动、能连续对话、能吃附件”转向“线程可观测性与长期运行能力”。
