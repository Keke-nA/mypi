# Mom 进度记录（十）

日期：2026-03-28

本文记录一次对 weather skill 的简化：把它从“说明 + helper script”改成“纯说明型 skill”，用于验证当前 mom 是否只靠 skill 描述也会自己选择 `curl` 查询天气。

---

## 1. 这轮做了什么

这轮没有改 `package/mom` 代码，而是只调整了 workspace 里的 skill 资产：

```text
/home/gao-wsl/mypi/.mom-data/skills/weather-curl/
```

当前这个 skill 已经被简化成：

- 只保留 `SKILL.md`
- 不再保留 `weather.sh`

也就是说，这次想验证的不是“脚本能不能跑”，而是：

> 只靠 skill 说明，mom 会不会自己决定去用 `bash` + `curl`。

---

## 2. 为什么要这样改

上一轮为了确保天气能力尽快可用，给 `weather-curl` skill 配了一个现成脚本。

那种方式当然更稳，但它同时会掺进另一个变量：

- 是 skill 说明起作用，还是 helper script 起作用？

这轮把脚本拿掉之后，测试会更纯：

- 如果 mom 仍然会自己调用 `curl wttr.in`
- 那就说明当前 skill 机制对这种轻量工作流已经足够了

---

## 3. 现在的 `SKILL.md` 语义

当前 `SKILL.md` 只描述一件事：

- 遇到天气问题时，优先使用 `bash` 工具直接运行 `curl`

推荐的两类命令是：

### 当前天气

```bash
curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=3'
```

### 预报 / 明天

```bash
curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=j1'
```

并明确告诉 mom：

- `杭州` 映射到 `Hangzhou`
- 查完后自己总结结果
- 不要先说“不能联网”
- 除非用户要求，否则不要把原始 JSON 整段贴出来

---

## 4. 当前 skill 目录状态

调整之后，skill 目录里只剩：

```text
/home/gao-wsl/mypi/.mom-data/skills/weather-curl/SKILL.md
```

这意味着当前 `weather-curl` 已经是一个**纯 prompt / instruction skill**，而不是依赖本地 helper script 的 skill。

---

## 5. 这轮的意义

这轮的重点不是增强功能，而是缩小实验变量。

如果这轮测试通过，就说明：

- 当前 mom 的 skill 机制
- 加上现有 `bash` 工具
- 再加一份清晰的 `SKILL.md`

已经足以把一个简单工作流引导出来。

这对后面很有价值，因为很多 skill 其实不一定需要单独脚本：

- 查天气
- 查某个网站页面
- 跑简单命令组合
- 用现成 CLI 拉信息

如果只靠说明就能驱动 agent 去做，那 skill 的维护成本会低很多。

---

## 6. 当前状态总结

截至 `mom10.md` 记录点，`weather-curl` 这个样例 skill 已经从：

- `SKILL.md + weather.sh`

简化成：

- `SKILL.md only`

也就是说，接下来的测试重点变成：

- `mom` 是否会因为看到 skill 描述，而自己选择执行 `curl`

而不是：

- 是否会调用预先封装好的 helper script

---

## 7. 一句话结论

截至 `mom10.md` 记录点，`mypi` 中的 `weather-curl` skill 已经被简化成纯说明型 skill，后续测试可以更直接验证：当前 mom 是否仅凭 `SKILL.md` 描述，就会自行用 `curl` 完成天气查询。
