# Mom 进度记录（十二）

日期：2026-03-29

本文记录一轮很小但很关键的 docker sandbox 体验修正：**让 mom 在 docker 模式下更明确地认知实际 workspace 路径。**

---

## 1. 背景

在前面的联调里，`mom` 的 docker sandbox 已经可以正常启动：

- container 已运行
- host workingDir 已挂到 container 的 `/workspace`
- `mom` 本体跑在 host
- tools 通过 `docker exec -w /workspace ...` 在容器里执行

但在一次删除 periodic event 的实际操作中，agent 仍然使用了 host 路径：

```text
/home/gao-wsl/mypi/.mom-data/events/...
```

而不是 docker sandbox 内真实应使用的路径：

```text
/workspace/events/...
```

这会带来一个体验问题：

- 在容器里执行 `rm -f /home/...` 时，目标路径实际上并不存在
- 但 `rm -f` 会吞掉错误
- 所以模型容易误判自己已经删除成功

---

## 2. 这轮修正了什么

本轮没有改工具实现，也没有做路径重写，而是把 **docker 模式下的路径语义** 更明确地写进了 `mom` 的 system prompt。

修改文件：

- `package/mom/src/agent.ts`

### 新增的 prompt 约束

现在每次 run 前，`mom` 都会更明确地告诉模型：

- `Sandbox workspace root: /workspace`
- `Host workspace root: /home/gao-wsl/mypi/.mom-data`
- 在 docker 模式下，`read/write/edit/bash` 实际运行在 docker sandbox 内
- 真正可用的工具路径是 `/workspace/...`
- 不要在 tool calls 里使用 host 路径 `/home/...`
- 如果旧日志或旧回复中出现了 host 路径，应先把它翻译成 `/workspace/...` 再用工具
- 对外回复路径时，也优先使用 sandbox 可见路径 `/workspace/...` 或相对路径

### 这轮的设计判断

这里故意没有先上“自动重写命令里路径”的逻辑，而是先把语义边界讲清楚：

- host path 是宿主机路径
- sandbox path 才是容器内工具的真实路径

因为当前问题的根因不是工具层不会执行，而是模型在已有上下文和旧回复影响下，混淆了 host path 与 sandbox path。

---

## 3. 这轮带来的直接收益

修完之后，docker 模式的工作区语义更一致了：

- 启动日志里仍然会显示 host workingDir，便于运维定位
- 但给模型的运行时 prompt 现在会更强约束它使用 `/workspace`
- 旧 host 路径现在也有了明确翻译规则

这对于下面这类操作尤其重要：

- 删除 `events/*.json`
- 用 `bash` 操作文件
- 用 `read/write/edit` 访问工作区
- 在回复里向用户报告“文件位置”

---

## 4. 一句话总结

这轮不是在改 sandbox 机制本身，而是在修复 **docker 模式下的路径认知**：

> mom 现在会更明确地区分“host workspace path”和“docker sandbox workspace path”，并要求模型在 docker 模式下只把 `/workspace` 视为真实工具工作区。
