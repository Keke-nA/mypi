# Mom 进度记录（九）

日期：2026-03-28

本文记录一次针对 `skills` 能力的实际验证：在 `mypi` 的 mom workspace 里新增一个可直接使用的天气查询 skill，验证当前 skill 发现与使用链路是否可落地。

---

## 1. 这轮做了什么

这轮没有改 `package/mom` 代码，而是在 mom 当前工作区下直接新增了一个 workspace 级 skill：

```text
/home/gao-wsl/mypi/.mom-data/skills/weather-curl/
  SKILL.md
  weather.sh
```

它的目标很简单：

- 当用户问“杭州天气”之类的问题时
- 不再默认回答“我不能联网”
- 而是优先尝试通过 `curl` 调 `wttr.in`

---

## 2. skill 内容

### 2.1 `SKILL.md`

`SKILL.md` 做了几件事：

- 通过 frontmatter 声明：
  - `name: weather-curl`
  - `description: Query current weather or tomorrow forecast with curl against wttr.in...`
- 明确告诉 mom：
  - 遇到天气问题时优先使用这个 skill
  - 不要在尝试之前就直接回答“不能联网”
- 提供推荐命令：

```bash
bash ./skills/weather-curl/weather.sh Hangzhou current
bash ./skills/weather-curl/weather.sh Hangzhou tomorrow
```

### 2.2 `weather.sh`

脚本负责真正执行查询。

当前支持：

- `current`
- `tomorrow`

并且做了一个最小别名映射：

- `杭州 -> Hangzhou`

也就是说，模型哪怕直接把用户说的“杭州”带进去，也能跑通。

---

## 3. 为什么这能验证 skill 链路

当前 `mom` 的 skill 机制是：

1. 每次 run 前，重新扫描 workspace / channel 下的 `skills/`
2. 读取每个 skill 目录中的 `SKILL.md`
3. 从 frontmatter 中提取 `name` 和 `description`
4. 把 skill 摘要、目录路径和 `SKILL.md` 路径注入 system prompt
5. 模型如果认为有用，就可以再通过 `read` / `bash` 去读 skill 或运行其中脚本

所以这次不需要改代码本身，也能验证：

- skill 能否被发现
- skill 说明是否足够让 agent 选择它
- skill 内的脚本是否能在当前 sandbox/workspace 里直接执行

---

## 4. 实测结果

已经直接在当前 workspace 根目录下验证了脚本：

### 当前天气

```bash
bash ./skills/weather-curl/weather.sh Hangzhou current
```

返回：

```text
hangzhou: ☀️   +17°C
```

### 明天天气

```bash
bash ./skills/weather-curl/weather.sh Hangzhou tomorrow
```

返回：

```text
Hangzhou tomorrow: 13–19°C, Partly Cloudy, max rain chance 100%, max wind 22 km/h
```

### 中文别名

```bash
bash ./skills/weather-curl/weather.sh 杭州 tomorrow
```

返回：

```text
Hangzhou tomorrow: 13–19°C, Partly Cloudy, max rain chance 100%, max wind 22 km/h
```

说明至少从 skill 资产本身来看：

- 文件结构是对的
- skill 脚本是可执行的
- 当前 host workspace 下确实可以 `curl` 查询天气

---

## 5. 这轮的意义

这轮虽然不是在加新框架能力，但它很重要，因为它验证了一个关键方向：

> 当前 mom 的 `skills` 不只是“能被扫描到”，而是已经可以承载一个真实可执行的小能力包。

这意味着后面很多重复性任务都可以按同样模式落：

- GitHub 查询
- 日报汇总
- 项目脚手架
- 常用发布脚本
- 环境诊断脚本

也就是说，`skills` 现在已经不是纯概念层了，而是能往里放真实工作流了。

---

## 6. 当前状态总结

截至 `mom9.md` 记录点，除了前面已经具备的：

- Slack 接入
- per-channel context
- follow-up 顺序处理
- sandbox
- 附件输入输出
- tool thread logs
- backfill
- events
- usage summary
- 旧格式 `context.jsonl` 自动恢复
- 离线 trigger 自动补处理
- live / replay trigger 去重
- replay backlog 提示与启动期 live 缓冲

之外，现在还完成了一个具体的 skills 验证样例：

- workspace 级 `weather-curl` skill
- 可执行天气查询脚本
- 可用于修正“默认说自己不能联网”的回答倾向

当前仍未完成的重点包括：

- `[SILENT]`
- workspace `settings.json`

---

## 7. 一句话结论

截至 `mom9.md` 记录点，`mypi` 中的 `mom` 已经能通过 workspace 级 `skills/` 挂载一个真实可执行的天气查询 skill；这说明当前 skill 机制已经足以承载实际工作流，而不只是展示性的 prompt 摘要。
