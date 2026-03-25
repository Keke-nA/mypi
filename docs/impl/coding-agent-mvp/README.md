# Coding-Agent MVP 实现记录

这组文档用于审查 `mypi` 当前 coding-agent MVP 的真实落地状态，而不是计划稿。

当前实现目标：

- 保持 `ai / agent / tui / coding-agent` 四层接口对齐
- 先完成 `session` 主干，再接 CLI/TUI
- 产出一个可以真实使用、真实调用 OpenAI 兼容接口、真实持久化 session 的 MVP

建议阅读顺序：

1. `docs/impl/coding-agent-mvp/01-session-foundation.md`
2. `docs/impl/coding-agent-mvp/02-cli-mvp.md`
3. `docs/impl/coding-agent-mvp/03-tui-mvp.md`
4. `docs/impl/coding-agent-mvp/05-config-and-presets.md`
5. `docs/impl/coding-agent-mvp/06-auto-compaction.md`
6. `docs/impl/coding-agent-mvp/04-validation.md`

当前状态总结：

- session storage / tree / context rebuild / runtime bridge 已实现
- CLI MVP 已实现
- `pi-tui` 交互式 TUI MVP 已实现
- `~/.mypi/agent/config.json` / `presets.json` 配置加载已实现
- 80% threshold auto-compaction / overflow recovery / context usage 估算已实现
- 真实 OpenAI 兼容 smoke 已通过
- 还没做真正的复杂 `interactive-app` 产品 polish、权限审批、更细颗粒的 auto-compaction UI
