# Mom 进度记录（二）

日期：2026-03-28

本文记录 `mypi` 中 `mom` 在 `mom1.md` 之后的两轮推进，重点覆盖：

- 同一窗口 follow-up 顺序处理
- Slack 附件输入链路

---

## 1. 本轮范围

在 `mom1.md` 的基础上，这一阶段的目标不再是“先能跑起来”，而是继续解决两个实际使用上的关键问题：

1. 同一个 DM / 频道窗口里连续发多条消息时，bot 不应该只会说 `Already working`
2. 用户在 Slack 里上传图片 / 文件后，bot 应该能把这些附件真正纳入工作流

也就是说，这一阶段的重点是：

- 让 `mom` 更像一个持续工作的会话体
- 让 `mom` 不再只是文本 bot，而是能围绕 Slack 里的附件工作

---

## 2. 第三轮：同窗口 follow-up 顺序处理

### 2.1 改动背景

在前两轮实现里，同一个 channel / DM 正在运行时，如果用户继续发消息，当前处理方式是：

- 先记入 `log.jsonl`
- 返回 `Already working`
- 不在当前 run 内继续处理这些消息

这种方式虽然能保证不并发打乱上下文，但交互体验仍然偏生硬。

### 2.2 本轮改动

这轮已经把这部分改成：

- 运行中的同一窗口新消息不再直接 busy 拒绝
- 改为走 `Agent.followUp()`
- 并显式使用 `one-at-a-time` 模式
- 同一窗口内消息 2、3 会按顺序接到当前 runner 后面继续处理
- 每条 follow-up 仍然各自保留一条独立 Slack 回复
- 每条回复也会继续写回该 channel 的 `log.jsonl`

### 2.3 当前语义

当前的处理语义是：

- 同一窗口：顺序处理
- 不同窗口：彼此独立
- 同一窗口内运行中新增消息：优先走 follow-up
- 如果 follow-up 到达时本轮 run 恰好已经结束，则会回退为下一次普通 run

### 2.4 这一步的意义

这一步之后，`mom` 的交互方式已经更贴近真实会话：

- 你在同一个窗口里继续补充消息
- bot 会顺着当前上下文继续处理
- 不需要反复等它停下来再重新触发

也就是说，`mom` 已经开始真正用上 `@mypi/agent` 内部的消息追加能力，而不是只靠外层 busy 判断。

---

## 3. 第四轮：Slack 附件输入链路

### 3.1 改动背景

在前几轮里，`mom` 已经具备：

- 输出附件：bot 生成文件后可以 `attach` 回 Slack
- 图片读取：如果图片已经在工作区里，`read` 工具可以把它作为 image content 返回

但它还不具备：

- 你直接在 Slack 里上传附件给 bot
- bot 自动把附件下载到工作区
- 再把附件真正纳入当前 prompt / context

### 3.2 本轮改动

这一轮已经补上：

#### `store.ts`

- 支持 Slack 附件元数据登记
- 支持后台下载附件到 `<channel>/attachments/`
- 支持等待下载完成后，再把附件交给 runner
- 支持把相对附件路径解析成 host 本地路径

#### `slack.ts`

- 支持读取 Slack 事件里的 `files`
- 支持“只有附件没有文本”的消息也进入链路
- 会把附件信息一起写入 `log.jsonl`

#### `main.ts`

- 已向 runner 暴露 `resolveAttachments()`
- runner 在真正执行前可以等待并拿到本地附件文件

#### `agent.ts`

- 当前消息会注入附件
- follow-up 消息也会顺序注入附件
- 图片附件会作为 image content 进入模型输入
- 非图片附件会把本地相对路径写进 `<slack_attachments>` 区块

#### `context.ts`

- `log.jsonl -> context.jsonl` 同步时会保留附件信息
- 历史图片附件在重新进入 session 上下文时，也会继续作为 image content 被使用

### 3.3 当前附件注入策略

#### 图片附件

处理方式：

- 下载到本地工作区
- 转成 base64 image content
- 直接作为模型输入的一部分

因此，现在已经可以开始测试：

- 上传报错截图
- 上传界面截图
- 上传图片后直接问 bot 图里是什么

#### 非图片附件

处理方式：

- 下载到本地工作区
- 不直接转 image content
- 把路径写进 prompt / context 的 `<slack_attachments>` 区块

例如：

```text
<slack_attachments>
D123456/attachments/1712345678000_error.log
D123456/attachments/1712345679000_config.json
</slack_attachments>
```

后续 agent 就可以再通过 `read` 工具去读取这些文件。

### 3.4 当前附件落盘位置

当前附件会落到：

```text
<working-directory>/<channel-id>/attachments/
```

例如：

```text
~/mypi/.mom-data/D123456/attachments/
```

### 3.5 这一步的意义

这一步之后，`mom` 已经不再只是一个“文本消息 + 工具”的 bot，而开始具备：

- 看 Slack 图片的能力
- 读取 Slack 文件的能力
- 把用户上传的附件和本地 workspace 连起来的能力
- 在重启或后续继续运行时保留这些附件上下文的能力

也就是说，`mom` 已经从：

- 能聊天
- 能跑工具

继续推进到：

- 能围绕 Slack 里的真实附件工作

---

## 4. 当前状态总结

截至 `mom2.md` 记录点，`mom` 已经具备：

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

当前仍未完成的重点包括：

- tool 线程日志
- skills
- backfill
- events
- usage summary

---

## 5. 验证结果

已完成：

- `npm run build --workspace @mypi/mom`
- `npm run typecheck --workspace @mypi/mom`
- 根级 `npm run typecheck` 已复查，仍被既有 `package/coding-agent/test/*` 历史类型错误阻塞，与本阶段 mom 改动无关

尚待进一步实机 smoke：

- Slack 上传图片后直接提问
- Slack 上传文本 / 日志 / 配置文件后让 bot 读取
- docker 模式下附件 + 工具的联调

---

## 6. 一句话结论

截至 `mom2.md` 记录点，`mypi` 中的 `mom` 已经从“能连上 Slack 并聊天”推进到了“能在同一窗口顺序处理多条消息，并把 Slack 附件真正纳入模型与工作区流程”的阶段。
