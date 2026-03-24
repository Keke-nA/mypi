# Changelog

## [Unreleased]

## [0.60.0] - 2026-03-18

### Fixed

- 修复了 tmux xterm `modifyOtherKeys` 与 `Backspace`、`Escape` 和 `Space` 的匹配，并通过将 Windows 终端 sessions 与旧版终端 ([#2293](https://github.com/badlogic/pi-mono/issues/2293)) 区别对待来解决原始 `\x08` 退格歧义

## [0.59.0] - 2026-03-17

## [0.58.4] - 2026-03-16

## [0.58.3] - 2026-03-15

## [0.58.2] - 2026-03-15

### Added

- 通过 `SelectListLayoutOptions` 添加了可配置的 `SelectList` 主列大小调整，包括 custom primary-label 截断 hooks（[#2154](https://github.com/badlogic/pi-mono/pull/2154) by [@markusylisiurunen](https://github.com/markusylisiurunen)）

### Fixed

- 修复了 full-screen 重绘后剩余的陈旧回滚，例如 session 通过在擦除回滚之前清除屏幕进行切换（[#2155](https://github.com/badlogic/pi-mono/pull/2155) by [@Perlence](https://github.com/Perlence)）
- 修复了 markdown 块元素后面紧跟着下一个块或文档末尾时的尾随空白行（[#2152](https://github.com/badlogic/pi-mono/pull/2152) [@markusylisiurunen](https://github.com/markusylisiurunen)）

## [0.58.1] - 2026-03-14

### Fixed

- 修复了自动完成中的 Windows shell 和路径处理，以正确处理驱动器号和混合路径分隔符
- 修复了编辑器粘贴以保留文字内容而不是标准化换行符，防止嵌入转义序列的文本内容损坏 ([#2064](https://github.com/badlogic/pi-mono/issues/2064))
- 修复了制表符补全以在补全相对路径时保留 `./` 前缀 ([#2087](https://github.com/badlogic/pi-mono/issues/2087))
- 修复了 `ctrl+backspace` 与 Windows 终端上的普通 `backspace` 无法区分的问题。 `0x08` 现在被识别为 `ctrl+backspace` 而不是 `backspace`，使得 `ctrl+backspace` 可在终端上绑定，并在终端上生成不同的字节 ([#2139](https://github.com/badlogic/pi-mono/issues/2139))

## [0.58.0] - 2026-03-14

### Added

- 在编辑器中添加了粘贴标记原子段处理，在自动换行和cursor导航期间将粘贴标记视为不可分割的单元（[#2111](https://github.com/badlogic/pi-mono/pull/2111) by [@haoqixu](https://github.com/haoqixu)）

### Fixed

- 修复了宽 Unicode 文本（CJK，全角字符）的`Input`水平滚动，以使用视觉列宽和严格的切片边界，防止渲染行溢出和TUI崩溃（[#1982](https://github.com/badlogic/pi-mono/issues/1982)）
- 修复了 xterm `modifyOtherKeys` 对`matchesKey()`中`Tab`的处理，当`extended-keys-format`保留为默认`xterm`时，恢复`shift+tab`和tmux中其他修改的Tab绑定
- 修复了窄终端宽度（[#2103](https://github.com/badlogic/pi-mono/pull/2103) by [@haoqixu](https://github.com/haoqixu)）中编辑器滚动指示器渲染崩溃的问题
- 修复了编辑器 `setText()` 和 input 路径中的制表符未标准化为空格的问题（[#2027](https://github.com/badlogic/pi-mono/pull/2027) by [@haoqixu](https://github.com/haoqixu)）
- 修复了宽字符（CJK、全角）恰好落在换行边界（[#2082](https://github.com/badlogic/pi-mono/pull/2082) by [@haoqixu](https://github.com/haoqixu)）时出现的`wordWrapLine`溢出问题
- 修复了`Input`粘贴中的制表符未标准化为空格（[#1975](https://github.com/badlogic/pi-mono/pull/1975)由[@haoqixu](https://github.com/haoqixu)）

## [0.57.1] - 2026-03-07

### Added

- 添加了 `treeFoldOrUp` 和 `treeUnfoldOrDown` 编辑器操作，以及 `Ctrl+←`/`Ctrl+→` 和 `Alt+←`/`Alt+→`（[#1724](https://github.com/badlogic/pi-mono/pull/1724) by [@Perlence](https://github.com/Perlence)）的默认绑定
- 向keybinding系统添加了数字键（`0-9`），包括KittyCSI-u和xterm`modifyOtherKeys`对`ctrl+1`（[#1905](https://github.com/badlogic/pi-mono/issues/1905)）等绑定的支持

### Fixed

- 修复了忽略键入文本的自动完成选择：现在突出显示在用户键入时遵循第一个前缀匹配，并且始终在 Enter 上选择完全匹配（[#1931](https://github.com/badlogic/pi-mono/pull/1931) by [@aliou](https://github.com/aliou)）
- 修复了`matchesKey()`和`parseKey()`中的xterm`modifyOtherKeys`解析，恢复了Ctrl-basedkeybindings，并修改了tmux中的Enter键，当`extended-keys-format`保留为默认`xterm`（[#1872](https://github.com/badlogic/pi-mono/issues/1872)）时
- 修复了斜杠-command Tab 补全，以便在可用时立即打开参数补全（[#1481](https://github.com/badlogic/pi-mono/pull/1481) by [@barapa](https://github.com/barapa)）

## [0.57.0] - 2026-03-07

### Added

- 通过 `OverlayOptions.nonCapturing` 添加了 non-capturing overlays 和新的 `OverlayHandle` 方法：`focus()`、`unfocus()` 和 `isFocused()`，用于编程 overlay 焦点控制（[#1916](https://github.com/badlogic/pi-mono/pull/1916) [@nicobailon](https://github.com/nicobailon)）

### Changed

- Overlay 合成顺序现在使用焦点顺序，因此将 overlays render 集中在顶部，同时保留显示/hide 行为的堆栈语义（[#1916](https://github.com/badlogic/pi-mono/pull/1916) by [@nicobailon](https://github.com/nicobailon)）

### Fixed

- 修复了自动焦点恢复以跳过 non-capturing overlays 并修复了 `hideOverlay()` 仅在弹出的 overlay 具有焦点时重新分配焦点（[#1916](https://github.com/badlogic/pi-mono/pull/1916) by [@nicobailon](https://github.com/nicobailon)）

## [0.56.3] - 2026-03-06

### Added

- 当 Kitty 键盘协议不可用时，添加了 xterm modifyOtherKeys 模式 2 回退，在 tmux ([#1872](https://github.com/badlogic/pi-mono/issues/1872)) 内启用修改后的输入键 (Shift+Enter、Ctrl+Enter)

## [0.56.2] - 2026-03-05

### Added

- 从`keys.ts`导出`decodeKittyPrintable()`，用于将KittyCSI-u序列解码为可打印字符

### Fixed

- 修复了当Kitty键盘协议处于活动状态时`Input`component不接受键入的字符（e.g.、VS代码1.110+），导致model选择器过滤器忽略击键（[#1857](https://github.com/badlogic/pi-mono/issues/1857)）
- 通过在终端宽度或高度变化时强制完全重绘（[#1844](https://github.com/badlogic/pi-mono/pull/1844) by [@ghoulr](https://github.com/ghoulr)），修复了终端调整大小期间编辑器/footer可见性漂移。

## [0.56.1] - 2026-03-05

### Fixed

- 修复了 markdown 块引用渲染，以将块引用样式与默认文本样式隔离，防止样式泄漏。

## [0.56.0] - 2026-03-04

### Fixed

- 修复了区域指示符符号的TUI宽度计算（e.g.部分标志序列，例如streaming期间的`🇨`），以防止差异渲染中的换行漂移和陈旧字符artifacts。
- 修复了KittyCSI-u处理以忽略不支持的修饰符，因此modifier-onlyevents不会插入杂散的可打印字符（[#1807](https://github.com/badlogic/pi-mono/issues/1807)）
- 通过自动插入粘贴文本而不是character-by-character，修复了single-line粘贴性能，防止粘贴过程中重复的`@`自动完成扫描（[#1812](https://github.com/badlogic/pi-mono/issues/1812)）
- 修复了`visibleWidth()`以忽略通用OSC转义序列（包括OSC 133个语义prompt标记），防止终端发出语义区域标记时宽度漂移（[#1805](https://github.com/badlogic/pi-mono/issues/1805)）
- 通过将块引用子项渲染为 block-level tokens ([#1787](https://github.com/badlogic/pi-mono/issues/1787)) 修复了 markdown 块引用删除嵌套列表内容的问题

## [0.55.4] - 2026-03-02

## [0.55.3] - 2026-02-27

## [0.55.2] - 2026-02-27

## [0.55.1] - 2026-02-26

### Fixed

- 通过通过`createRequire`加载`koffi`修复了VTinput初始化ESM，恢复VTinput模式，同时保持`koffi`从已编译的二进制文件外部化（[#1627](https://github.com/badlogic/pi-mono/pull/1627)由[@kaste](https://github.com/kaste)）

## [0.55.0] - 2026-02-24

## [0.54.2] - 2026-02-23

## [0.54.1] - 2026-02-22

### Fixed

- 将 koffi 导入从 top-level 更改为 `enableWindowsVTInput()` 中的动态 require，以防止 Bun 将所有 18 个平台 `.node` 文件 (~74MB) 嵌入到每个编译的二进制文件中。仅在 Windows 上需要 Koffi。

## [0.54.0] - 2026-02-19

## [0.53.1] - 2026-02-19

## [0.53.0] - 2026-02-17

## [0.52.12] - 2026-02-13

## [0.52.11] - 2026-02-13

## [0.52.10] - 2026-02-12

### Added

- 在`TUI`（`addInputListener`和`removeInputListener`）中添加了终端input监听器，让调用者在component处理之前拦截、转换或消耗原始input。

### Fixed

- 修复了`@`自动完成模糊匹配以针对路径段和前缀进行评分，减少嵌套路径的不相关匹配（[#1423](https://github.com/badlogic/pi-mono/issues/1423)）

## [0.52.9] - 2026-02-08

## [0.52.8] - 2026-02-07

### Added

- 将 `pasteToEditor` 添加到 `EditorComponent` API 以实现编程粘贴支持（[#1351](https://github.com/badlogic/pi-mono/pull/1351) by [@kaofelix](https://github.com/kaofelix)）
- 为 Input component（[#1373](https://github.com/badlogic/pi-mono/pull/1373) by [@Perlence](https://github.com/Perlence)）添加了 kill ring (ctrl+k/ctrl+y/alt+y) 和撤消 (ctrl+z) 支持

## [0.52.7] - 2026-02-06

## [0.52.6] - 2026-02-05

## [0.52.5] - 2026-02-05

## [0.52.4] - 2026-02-05

## [0.52.3] - 2026-02-05

## [0.52.2] - 2026-02-05

## [0.52.1] - 2026-02-05

## [0.52.0] - 2026-02-05

## [0.51.6] - 2026-02-04

### Changed

- 斜杠command菜单现在即使其他行有内容也会在第一行触发，允许将commands添加到现有文本之前（[#1227](https://github.com/badlogic/pi-mono/pull/1227)由[@aliou](https://github.com/aliou)）

### Fixed

- 通过处理设置列表中的小宽度（[#1246](https://github.com/badlogic/pi-mono/pull/1246) by [@haoqixu](https://github.com/haoqixu)）修复了`/settings`在狭窄终端中崩溃的问题

## [0.51.5] - 2026-02-04

## [0.51.4] - 2026-02-03

### Fixed

- 修复了 input 滚动以避免拆分表情符号序列（[#1228](https://github.com/badlogic/pi-mono/pull/1228) by [@haoqixu](https://github.com/haoqixu)）

## [0.51.3] - 2026-02-03

## [0.51.2] - 2026-02-03

### Added

- 在退出前添加`Terminal.drainInput()`以排出stdin（防止Kitty按键释放events泄漏​​过慢SSH）

### Fixed

- 修复了Kitty密钥释放events通过缓慢的SSH连接泄漏到父shell，通过耗尽stdin长达1秒（[#1204](https://github.com/badlogic/pi-mono/issues/1204)）
- 修复了编辑器中的旧换行符处理，以保留以前的换行符行为
- 修复了@自动完成以包含隐藏路径
- 修复了提交回退以遵守配置的 keybindings

## [0.51.1] - 2026-02-02

### Added

- 添加了 `PI_DEBUG_REDRAW=1` 环境变量，用于调试完全重绘（将触发器记录到 `~/.pi/agent/pi-debug.log`）

### Changed

- 终端高度变化不再触发完全重绘，减少调整大小时的闪烁
- `clearOnShrink`现在默认为`false`（使用`PI_CLEAR_ON_SHRINK=1`或`setClearOnShrink(true)`启用）

### Fixed

- 修复了表情符号cursor定位在Inputcomponent（[#1183](https://github.com/badlogic/pi-mono/pull/1183)由[@haoqixu](https://github.com/haoqixu)）

- 修复了在内容先前缩小后附加许多行时不必要的完全重绘（视口检查现在使用实际的先前内容大小而不是过时的最大值）
- 修复了由于 stdin 缓冲区竞争条件 ([#1185](https://github.com/badlogic/pi-mono/issues/1185)) 导致Ctrl+D 退出关闭父级 SSH session 的问题

## [0.51.0] - 2026-02-01

## [0.50.9] - 2026-02-01

## [0.50.8] - 2026-02-01

### Added

- 为垂直 cursor 导航添加了粘性列跟踪，以便编辑器在跨过短行时恢复首选列。 （[#1120](https://github.com/badlogic/pi-mono/pull/1120) [@Perlence](https://github.com/Perlence)）

### Fixed

- 修复了Kitty键盘协议基本布局回退，因此非QWERTY布局不会触发错误的快捷键（[#1096](https://github.com/badlogic/pi-mono/pull/1096)由[@rytswd](https://github.com/rytswd)）

## [0.50.7] - 2026-01-31

## [0.50.6] - 2026-01-30

### Changed

- 优化`isImageLine()`和`startsWith`short-circuit以实现更快的图像线条检测

### Fixed

- 修复了内容缩小时页脚下方出现的空行（e.g.、关闭`/tree`、清除multi-line编辑器）（[#1095](https://github.com/badlogic/pi-mono/pull/1095) by [@marckrenn](https://github.com/marckrenn)）
- 修复了当render待处理时（[#1099](https://github.com/badlogic/pi-mono/pull/1099)由[@haoqixu](https://github.com/haoqixu)）通过`stop()`退出TUI后，终端cursor保持隐藏状态

## [0.50.5] - 2026-01-30

### Fixed

- 修复了`isImageLine()`以检查行中任何位置的图像转义序列，而不仅仅是在开头。这可以防止 TUI 在渲染包含图像数据的行时崩溃。 （[#1091](https://github.com/badlogic/pi-mono/pull/1091) [@zedrdave](https://github.com/zedrdave)）

## [0.50.4] - 2026-01-30

### Added

- 添加Ctrl+B和Ctrl+F作为keybindings替代cursor字左/right导航（[#1053](https://github.com/badlogic/pi-mono/pull/1053)由[@ninlds](https://github.com/ninlds)）
- 添加字符跳转导航：Ctrl+]向前跳转到下一个字符，Ctrl+Alt+]向后跳转（[#1074](https://github.com/badlogic/pi-mono/pull/1074) by [@Perlence](https://github.com/Perlence)）
- 现在，编辑器在第一条视线处按向上键时跳转到行开头，在最后一条视线处按向下键时跳转到行尾（[#1050](https://github.com/badlogic/pi-mono/pull/1050) by [@4h9fbZ](https://github.com/4h9fbZ)）

### Changed

- 优化图像线条检测和框渲染cache，以获得更好的性能（[#1084](https://github.com/badlogic/pi-mono/pull/1084) by [@can1357](https://github.com/can1357)）

### Fixed

- 通过支持引用路径tokens（[#1077](https://github.com/badlogic/pi-mono/issues/1077)）修复了带有空格的路径的自动完成
- 修复了引用路径完成以避免在自动完成期间重复结束引号 ([#1077](https://github.com/badlogic/pi-mono/issues/1077))

## [0.50.3] - 2026-01-29

## [0.50.2] - 2026-01-29

### Added

- 为`EditorOptions`添加了`autocompleteMaxVisible`选项，并使用getter/setter方法来配置自动完成下拉高度（[#972](https://github.com/badlogic/pi-mono/pull/972) by [@masonc15](https://github.com/masonc15)）
- 添加了`alt+b`和`alt+f`作为单词导航的替代keybindings（`cursorWordLeft`，`cursorWordRight`）和`ctrl+d`作为`deleteCharForward`（[#1043](https://github.com/badlogic/pi-mono/issues/1043)由[@jasonish](https://github.com/jasonish)）
- 当强制文件自动完成仅触发一次匹配时，编辑器auto-applies单个建议（[#993](https://github.com/badlogic/pi-mono/pull/993) by [@Perlence](https://github.com/Perlence)）

### Changed

- 改进了`extractCursorPosition`性能：以相反顺序扫描行，当cursor位于视口上方时扫描early-outs，并将扫描限制到底部终端高度（[#1004](https://github.com/badlogic/pi-mono/pull/1004)乘[@can1357](https://github.com/can1357)）
- 自动完成改进：更好地处理部分匹配和边缘情况（[#1024](https://github.com/badlogic/pi-mono/pull/1024) by [@Perlence](https://github.com/Perlence)）

### Fixed

- 修复了反斜杠input缓冲导致编辑器中的字符显示延迟和inputcomponents（[#1037](https://github.com/badlogic/pi-mono/pull/1037)由[@Perlence](https://github.com/Perlence)）
- 修复了 markdown 表格渲染，具有适当的行分隔符和最小列宽（[#997](https://github.com/badlogic/pi-mono/pull/997) by [@tmustier](https://github.com/tmustier)）

## [0.50.1] - 2026-01-26

## [0.50.0] - 2026-01-26

### Added

- 为 TUI 类添加了 `fullRedraws` 只读属性，用于跟踪全屏重绘
- 添加了`PI_TUI_WRITE_LOG`环境变量来捕获原始ANSIoutput以进行调试

### Fixed

- 修复了附加行未提交回滚，导致视口填充时较早的内容被覆盖 ([#954](https://github.com/badlogic/pi-mono/issues/954))
- 斜杠command菜单现在仅在编辑器input为空时才会触发（[#904](https://github.com/badlogic/pi-mono/issues/904)）
- Center-anchoredoverlays现在在收缩后将终端尺寸调整得更高时保持垂直居中（[#950](https://github.com/badlogic/pi-mono/pull/950)乘[@nicobailon](https://github.com/nicobailon)）
- 修复了编辑器multi-line插入处理和lastAction跟踪（[#945](https://github.com/badlogic/pi-mono/pull/945) by [@Perlence](https://github.com/Perlence)）
- 修复了编辑器自动换行以保留 cursor 列（[#934](https://github.com/badlogic/pi-mono/pull/934) by [@Perlence](https://github.com/Perlence)）
- 修复了编辑器自动换行以使用 single-pass 回溯进行空白处理（[#924](https://github.com/badlogic/pi-mono/pull/924) by [@Perlence](https://github.com/Perlence)）
- 修复了Kitty图像ID分配和清理，以防止模块之间的图像ID冲突

## [0.49.3] - 2026-01-22

### Added

- `MarkdownTheme`上的`codeBlockIndent`属性可自定义代码块内容缩进（默认：2个空格）（[#855](https://github.com/badlogic/pi-mono/pull/855) by [@terrorobe](https://github.com/terrorobe)）
- 添加Alt+Delete作为删除单词转发的热键（[#878](https://github.com/badlogic/pi-mono/pull/878) by [@Perlence](https://github.com/Perlence)）

### Changed

- 模糊匹配现在连续匹配得分更高，并且更严厉地惩罚间隙以获得更好的相关性（[#860](https://github.com/badlogic/pi-mono/pull/860) by [@mitsuhiko](https://github.com/mitsuhiko)）

### Fixed

- 自动链接的电子邮件不再在 markdown output 中显示多余的 `(mailto:...)` 后缀（[#888](https://github.com/badlogic/pi-mono/pull/888) by [@terrorobe](https://github.com/terrorobe)）
- 修复了overlays的视口跟踪和cursor定位以及内容收缩场景
- 自动完成现在允许使用 `/` 个字符进行搜索（e.g.、`folder1/folder2`）（[#882](https://github.com/badlogic/pi-mono/pull/882) by [@richardgill](https://github.com/richardgill)）
- `@`文件attachments的目录补全不再添加尾随空格，允许继续自动补全到子目录中

## [0.49.2] - 2026-01-19

## [0.49.1] - 2026-01-18

### Added

- 使用 Ctrl+- 热键向编辑器添加了撤消支持。撤消将连续的单词字符合并为一个单元 (fish-style)。 （[#831](https://github.com/badlogic/pi-mono/pull/831) [@Perlence](https://github.com/Perlence)）
- 添加了对 Ctrl+symbol 键（Ctrl+\、Ctrl+]、Ctrl+-）及其 Ctrl+Alt 变体的旧版终端支持。 （[#831](https://github.com/badlogic/pi-mono/pull/831) [@Perlence](https://github.com/Perlence)）

## [0.49.0] - 2026-01-17

### Added

- 添加了 `showHardwareCursor` getter 和 setter 来控制 cursor 可见性，同时保持 IME 定位活动。 （[#800](https://github.com/badlogic/pi-mono/pull/800) [@ghoulr](https://github.com/ghoulr)）
- 添加了使用 yank 和 yank-pop keybindings 进行 Emacs-style kill ring 编辑。 （[#810](https://github.com/badlogic/pi-mono/pull/810) [@Perlence](https://github.com/Perlence)）
- 在编辑器键盘映射中添加了旧版 Alt+letter 处理和 Alt+D 删除单词转发支持。 （[#810](https://github.com/badlogic/pi-mono/pull/810) [@Perlence](https://github.com/Perlence)）

## [0.48.0] - 2026-01-16

### Added

- `EditorOptions` 带有可选的 `paddingX` 用于水平内容填充，加上 `getPaddingX()`/`setPaddingX()` 方法（[#791](https://github.com/badlogic/pi-mono/pull/791) by [@ferologics](https://github.com/ferologics)）

### Changed

- 现在默认禁用硬件cursor以获得更好的终端compatibility。将 `PI_HARDWARE_CURSOR=1` 设置为启用（替换禁用它的 `PI_NO_HARDWARE_CURSOR=1`）。

### Fixed

- 在编辑器中解码KittyCSI-u可打印序列，因此移动符号键（e.g.、`@`、`?`）可在启用Kitty键盘协议的终端中工作（[#779](https://github.com/badlogic/pi-mono/pull/779)由[@iamd3vil](https://github.com/iamd3vil)）

## [0.47.0] - 2026-01-16

### Breaking Changes

- `Editor` 构造函数现在需要 `TUI` 作为第一个参数：`new Editor(tui, theme)`。当内容超过终端高度时，这可以实现自动垂直滚动。 ([#732](https://github.com/badlogic/pi-mono/issues/732))

### Added

- 在`Editor`和`Input`components中支持IME的硬件cursor定位。终端 cursor 现在跟随文本 cursor 位置，从而为 CJK input 启用正确的 IME 候选窗口放置。 ([#719](https://github.com/badlogic/pi-mono/pull/719))
- `Focusable` components 接口需要硬件cursor 定位。当聚焦时，在 render output 内实现 `focused: boolean` 并发出 `CURSOR_MARKER`。
- 从package导出的`CURSOR_MARKER`常量和`isFocusable()`类型保护
- 编辑器现在支持 Page Up/Down 键（Fn+Up/Down on MacBook）用于滚动浏览大内容 ([#732](https://github.com/badlogic/pi-mono/issues/732))
- 扩展了终端 compatibility 的键盘映射覆盖范围：添加了对 tmux 中的 Home/End 键的支持、其他修饰符组合以及改进的键序列解析（[#752](https://github.com/badlogic/pi-mono/pull/752) by [@richardgill](https://github.com/richardgill)）

### Fixed

- 当文本超过屏幕高度时，编辑器不再破坏终端显示。内容现在垂直滚动，指示器显示视口上方/below 的线条。最大高度为终端的 30%（至少 5 行）。 ([#732](https://github.com/badlogic/pi-mono/issues/732))
- `visibleWidth()`和`extractAnsiCode()`现在处理APC转义序列（`ESC _ ... BEL`），修复包含cursor标记的字符串的宽度计算和字符串切片
- SelectList现在通过用空格替换换行符来处理multi-line描述（[#728](https://github.com/badlogic/pi-mono/pull/728)由[@richardgill](https://github.com/richardgill)）

## [0.46.0] - 2026-01-15

### Fixed

- 键盘快捷键（Ctrl+C、Ctrl+D等）现在适用于支持Kitty键盘协议和备用键报告（[#718](https://github.com/badlogic/pi-mono/pull/718) by [@dannote](https://github.com/dannote)）的终端中的非-Latin键盘布局（俄语、乌克兰语、保加利亚语等）

## [0.45.7] - 2026-01-13

## [0.45.6] - 2026-01-13

### Added

- `OverlayOptions` API 用于 overlay 定位和调整大小，CSS-like 值：`width`、`maxHeight`、`row`、`col` 接受数字（绝对）或百分比字符串 (e.g.， `"50%"`）。还支持`minWidth`、`anchor`、`offsetX`、`offsetY`、`margin`。 （[#667](https://github.com/badlogic/pi-mono/pull/667) [@nicobailon](https://github.com/nicobailon)）
- `OverlayOptions.visible` 响应式回调 overlays - 接收终端尺寸，返回 false 隐藏（[#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon)）
- `showOverlay()` 现在返回 `OverlayHandle` 以及 `hide()`、`setHidden(boolean)`、`isHidden()`，用于编程可见性控制（[#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon)）
- 新导出类型：`OverlayAnchor`、`OverlayHandle`、`OverlayMargin`、`OverlayOptions`、`SizeValue`（[#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon)）
- `truncateToWidth()` 现在接受可选的 `pad` 参数，用空格将结果填充到恰好 `maxWidth`（[#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon)）

### Fixed

- 由于复杂的 ANSI/OSC 序列（e.g.，子代理output中的超链接）（[#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon)），当渲染的行超出终端宽度时，Overlay合成崩溃

## [0.45.5] - 2026-01-13

## [0.45.4] - 2026-01-13

## [0.45.3] - 2026-01-13

## [0.45.2] - 2026-01-13

## [0.45.1] - 2026-01-13

## [0.45.0] - 2026-01-13

## [0.44.0] - 2026-01-12

### Added

- `SettingsListOptions` 与 `enableSearch` 用于`SettingsList` 中的模糊过滤（[#643](https://github.com/badlogic/pi-mono/pull/643) by [@ninlds](https://github.com/ninlds)）
- `pageUp`和`pageDown`关键支持`selectPageUp`/`selectPageDown`编辑器操作（[#662](https://github.com/badlogic/pi-mono/pull/662)至[@aliou](https://github.com/aliou)）

### Fixed

- 编号列表项显示“1”。对于代码块破坏列表连续性时的所有项目（[#660](https://github.com/badlogic/pi-mono/pull/660) by [@ogulcancelik](https://github.com/ogulcancelik)）

## [0.43.0] - 2026-01-11

### Added

- 用于模糊文本匹配的`fuzzyFilter()`和`fuzzyMatch()`实用程序
- 斜线command自动完成现在使用模糊匹配而不是前缀匹配

### Fixed

- Cursor现在在退出时移动到内容末尾，防止状态行被覆盖（[#629](https://github.com/badlogic/pi-mono/pull/629)被[@tallshort](https://github.com/tallshort)）
- 在每条渲染线后重置ANSI样式以防止样式泄漏

## [0.42.5] - 2026-01-11

### Fixed

- 闪烁减少仅 re-rendering 更改线路（[#617](https://github.com/badlogic/pi-mono/pull/617) [@ogulcancelik](https://github.com/ogulcancelik)）
- Cursor 当内容缩小而剩余行不变时的位置跟踪
- 如果终端在暂停时调整大小，TUI在暂停/resume后会以错误的尺寸渲染（[#599](https://github.com/badlogic/pi-mono/issues/599)）
- 包含Kitty密钥释放模式（MAC地址中的e.g.、`:3F`）的粘贴内容被错误地过滤掉（[#623](https://github.com/badlogic/pi-mono/pull/623) by [@ogulcancelik](https://github.com/ogulcancelik)）

## [0.42.4] - 2026-01-10

## [0.42.3] - 2026-01-10

## [0.42.2] - 2026-01-10

## [0.42.1] - 2026-01-09

## [0.42.0] - 2026-01-09

## [0.41.0] - 2026-01-09

## [0.40.1] - 2026-01-09

## [0.40.0] - 2026-01-08

## [0.39.1] - 2026-01-08

## [0.39.0] - 2026-01-08

### Added

- **实验：** Overlay 与 `{ overlay: true }` 选项合成 `ctx.ui.custom()`（[#558](https://github.com/badlogic/pi-mono/pull/558) by [@nicobailon](https://github.com/nicobailon)）

## [0.38.0] - 2026-01-08

### Added

- `EditorComponent` custom 编辑器实现接口
- `StdinBuffer`类将批量stdin分割成单独的序列（改编自[OpenTUI](https://github.com/anomalyco/opentui)、MIT许可证）

### Fixed

- 与其他 events 超过 SSH ([#538](https://github.com/badlogic/pi-mono/pull/538)) 进行批处理时，按键不再丢失

## [0.37.8] - 2026-01-07

### Added

- `Component.wantsKeyRelease`属性到opt-in到按键释放events（默认为 false）

### Fixed

- TUI现在默认过滤掉按键释放events，防止编辑器和其他components中的按键double-processing

## [0.37.7] - 2026-01-07

### Fixed

- `matchesKey()`现在可以正确匹配未修改字母键的Kitty协议序列（释放密钥events所需）

## [0.37.6] - 2026-01-06

### Added

- Kitty 键盘协议标志 2 支持按键释放 events。新导出：`isKeyRelease(data)`、`isKeyRepeat(data)`、`KeyEventType` 类型。支持Kitty协议（Kitty、Ghostty、WezTerm）的终端现在发送正确的key-upevents。

## [0.37.5] - 2026-01-06

## [0.37.4] - 2026-01-06

## [0.37.3] - 2026-01-06

## [0.37.2] - 2026-01-05

## [0.37.1] - 2026-01-05

## [0.37.0] - 2026-01-05

### Fixed

- 通过 Markdown 渲染（[#457](https://github.com/badlogic/pi-mono/pull/457) by [@robinwander](https://github.com/robinwander)）粘贴尾随空白超出终端宽度的文本时发生崩溃

## [0.36.0] - 2026-01-05

## [0.35.0] - 2026-01-05

## [0.34.2] - 2026-01-04

## [0.34.1] - 2026-01-04

### Added

- keybinding系统中的符号键支持：具有32个符号键的`SymbolKey`类型，`Key`常量（e.g.，`Key.backtick`，`Key.comma`），更新`matchesKey()`和`parseKey()`以处理符号input（[#450](https://github.com/badlogic/pi-mono/pull/450)由[@kaofelix](https://github.com/kaofelix)）

## [0.34.0] - 2026-01-04

### Added

- `Editor.getExpandedText()` 方法，返回文本，其中粘贴标记扩展到其实际内容（[#444](https://github.com/badlogic/pi-mono/pull/444) by [@aliou](https://github.com/aliou)）

## [0.33.0] - 2026-01-04

### Breaking Changes

- **删除按键检测功能**：所有`isXxx()`按键检测功能（`isEnter()`、`isEscape()`、`isCtrlC()`等）已被删除。使用 `matchesKey(data, keyId)` 代替（e.g.、`matchesKey(data, "enter")`、`matchesKey(data, "ctrl+c")`）。这会影响使用 `ctx.ui.custom()` 和键盘 input 处理的 hooks 和 custom tools。 ([#405](https://github.com/badlogic/pi-mono/pull/405))

### Added

- `Editor.insertTextAtCursor(text)` 编程文本插入方法 ([#419](https://github.com/badlogic/pi-mono/issues/419))
- `EditorKeybindingsManager` 用于可配置编辑器keybindings。 Components 现在使用 `matchesKey()` 和 keybindings 管理器，而不是单独的 `isXxx()` 函数。 （[#405](https://github.com/badlogic/pi-mono/pull/405) [@hjanuschka](https://github.com/hjanuschka)）

### Changed

- 重构密钥检测：将 `is*()` 函数合并为通用 `matchesKey(data, keyId)` 函数，该函数接受 `"ctrl+c"`、`"shift+enter"`、`"alt+left"` 等密钥标识符。

## [0.32.3] - 2026-01-03

## [0.32.2] - 2026-01-03

### Fixed

- 斜杠command自动补全现在会触发以`.`、`-`或`_`开头的commands（e.g.、`/.land`、`/-foo`）([#422](https://github.com/badlogic/pi-mono/issues/422))

## [0.32.1] - 2026-01-03

## [0.32.0] - 2026-01-03

### Changed

- 编辑器component现在使用自动换行而不是character-level换行以提高可读性（[#382](https://github.com/badlogic/pi-mono/pull/382) by [@nickseelert](https://github.com/nickseelert)）

### Fixed

- Shift+Space、Shift+Backspace和Shift+Delete现在可以在Kitty-protocol终端（Kitty、WezTerm等）中正常工作，而不是被默默忽略（[#411](https://github.com/badlogic/pi-mono/pull/411)被[@nathyong](https://github.com/nathyong)）

## [0.31.1] - 2026-01-02

### Fixed

- `visibleWidth()` 现在剥离 OSC 8 个超链接序列，修复可点击链接的文本换行（[#396](https://github.com/badlogic/pi-mono/pull/396) by [@Cursivez](https://github.com/Cursivez)）

## [0.31.0] - 2026-01-02

### Added

- `isShiftCtrlO()`Shift+Ctrl+O按键检测功能（Kitty协议）
- `isShiftCtrlD()`Shift+Ctrl+D按键检测功能（Kitty协议）
- 用于全局调试键处理的`TUI.onDebug`回调（Shift+Ctrl+D）
- `wrapTextWithAnsi()`实用程序现已导出（将文本换行至宽度，保留ANSI代码）

### Changed

- README.md 完全重写，包含准确的 component 文档、theme 接口和示例
- `visibleWidth()` 重新实现了 grapheme-based 宽度计算，在 Bun 上快了 10 倍，在 Node 上快了约 15%（[#369](https://github.com/badlogic/pi-mono/pull/369) by [@nathyong](https://github.com/nathyong)）

### Fixed

- Markdown component 现在将 HTML 标签呈现为纯文本，而不是默默地删除它们 ([#359](https://github.com/badlogic/pi-mono/issues/359))
- 遇到未定义的代码点（[#372](https://github.com/badlogic/pi-mono/pull/372) by [@HACKE-RC](https://github.com/HACKE-RC)）时，`visibleWidth()`和字素迭代会崩溃
- ZWJ表情符号序列（彩虹旗、家庭等）现在render具有正确的宽度，而不是被分割成多个字符（[#369](https://github.com/badlogic/pi-mono/pull/369) by [@nathyong](https://github.com/nathyong)）

## [0.29.0] - 2025-12-25

### Added

- **粘贴文件路径之前自动-space**：粘贴文件路径（以`/`、`~`或`.`开头）并且cursor位于单词字符之后时，会自动在前面添加一个空格以提高可读性。从 macOS 拖动屏幕截图时很有用。 （[#307](https://github.com/badlogic/pi-mono/pull/307) [@mitsuhiko](https://github.com/mitsuhiko)）
- **Inputcomponent**的文字导航：添加了Ctrl+Left/Right和Alt+Left/Right对word-by-wordcursor运动的支持。 （[#306](https://github.com/badlogic/pi-mono/pull/306) [@kim0](https://github.com/kim0)）
- **完整 Unicode input**：Input component 现在接受超过 ASCII 的 Unicode 字符。 ([#306](https://github.com/badlogic/pi-mono/pull/306) by [@kim0](https://github.com/kim0))

### Fixed

- **Readline-style Ctrl+W**：现在在删除前面的单词之前跳过尾随空格，匹配标准 readline 行为。 （[#306](https://github.com/badlogic/pi-mono/pull/306) [@kim0](https://github.com/kim0)）
