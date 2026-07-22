# OpenTUI 使用文档

> OpenTUI 是一个用 Zig 编写的原生终端 UI 核心，提供 TypeScript 绑定。它基于组件架构，具有灵活的布局能力，可用于创建复杂的终端应用程序。

> **本项目约定（ModuleAgent TUI，`@opentui/core` 0.2.x + Solid 绑定）**：
> - 文本样式一律使用 `attributes={TextAttributes.*}`（来自 `@opentui/core`），如 `attributes={TextAttributes.DIM}`、`attributes={TextAttributes.BOLD | TextAttributes.ITALIC}`。`<text>` 上的 `dim` / `bold` / `italic` / `height` prop 在此版本中**无效（运行时静默忽略）**，不要使用。
> - 边框圆角的正确写法是 `borderStyle="rounded"`；`border="round"` 之类的写法无效。
> - `<input>` 的类型签名 `Omit<TextareaOptions, "height" | "minHeight" | "maxHeight" | ...>`——**高度恒为 1**，传 `height` 不会生效；需要多行输入请用 `<textarea>`。
> - 下文为上游官方文档整理，示例中的 `height` 均为容器类组件（Box/ScrollBox/Select/Textarea 等）的合法布局属性，与上述废弃 prop 无关；`SyntaxStyle.fromStyles` 里的 `bold: true` / `italic: true` 是语法高亮样式的合法字段，也不是 `<text>` prop。

---

## 目录

1. [Getting Started（入门）](#1-getting-started入门)
2. [Core Concepts（核心概念）](#2-core-concepts核心概念)
   - [Renderer](#21-renderer)
   - [Renderables](#22-renderables)
   - [Constructs](#23-constructs)
   - [Renderables vs Constructs](#24-renderables-vs-constructs)
   - [Layout System](#25-layout-system)
   - [Keyboard Input](#26-keyboard-input)
   - [Console Overlay](#27-console-overlay)
   - [Colors](#28-colors)
   - [Lifecycle and Cleanup](#29-lifecycle-and-cleanup)
3. [Plugin API（插件 API）](#3-plugin-api插件-api)
   - [Plugin Slots](#31-plugin-slots)
   - [Core Slots](#32-core-slots)
   - [React Slots](#33-react-slots)
   - [Solid Slots](#34-solid-slots)
4. [Components（组件）](#4-components组件)
   - [Text](#41-text)
   - [Box](#42-box)
   - [Input](#43-input)
   - [Textarea](#44-textarea)
   - [Select](#45-select)
   - [TabSelect](#46-tabselect)
   - [ScrollBox](#47-scrollbox)
   - [ScrollBar](#48-scrollbar)
   - [Slider](#49-slider)
   - [Code](#410-code)
   - [Markdown](#411-markdown)
   - [Line Numbers](#412-line-numbers)
   - [FrameBuffer](#413-framebuffer)
   - [ASCIIFont](#414-asciifont)
   - [Diff](#415-diff)
5. [Bindings（框架绑定）](#5-bindings框架绑定)
   - [Solid.js](#51-solidjs)
   - [React](#52-react)
6. [Keymap（按键映射引擎）](#6-keymap按键映射引擎)
   - [Overview](#61-overview)
   - [Hosts](#62-hosts)
   - [Core](#63-core)
   - [React](#64-react)
   - [Solid](#65-solid)
   - [Built-in Addons](#66-built-in-addons)
   - [Custom Addons](#67-custom-addons)
7. [Reference（参考）](#7-reference参考)
   - [Environment Variables](#71-environment-variables)
   - [Tree-sitter](#72-tree-sitter)
   - [Color Matrix](#73-color-matrix)

---

## 1. Getting Started（入门）

### 安装

OpenTUI 目前仅支持 Bun（Deno 和 Node 支持正在开发中）。

```bash
mkdir my-tui && cd my-tui
bun init -y
bun add @opentui/core
```

### Hello World

创建 `index.ts`：

```typescript
import { createCliRenderer, Text } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

renderer.root.add(
  Text({
    content: "Hello, OpenTUI!",
    fg: "#00FF00",
  }),
)
```

运行：

```bash
bun index.ts
```

按 `Ctrl+C` 退出。

### 组合组件

```typescript
import { createCliRenderer, Box, Text } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
})

renderer.root.add(
  Box(
    { borderStyle: "rounded", padding: 1, flexDirection: "column", gap: 1 },
    Text({ content: "Welcome", fg: "#FFFF00" }),
    Text({ content: "Press Ctrl+C to exit" }),
  ),
)
```

---

## 2. Core Concepts（核心概念）

### 2.1 Renderer

`CliRenderer` 是 OpenTUI 的驱动核心，管理终端输出、处理输入事件、运行渲染循环。

#### 创建 Renderer

```typescript
import { createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
})
```

工厂函数完成三件事：
1. 加载原生 Zig 渲染库
2. 配置终端设置（鼠标、键盘协议、屏幕模式）
3. 返回初始化后的 `CliRenderer` 实例

#### 配置选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `screenMode` | `ScreenMode` | `"alternate-screen"` | 终端屏幕模式 |
| `footerHeight` | `number` | `12` | split-footer 模式的底部区域行数 |
| `externalOutputMode` | `ExternalOutputMode` | 取决于 screenMode | stdout 写入处理方式 |
| `consoleMode` | `ConsoleMode` | `"console-overlay"` | 控制台叠加层行为 |
| `exitOnCtrlC` | `boolean` | `true` | Ctrl+C 时自动销毁 renderer |
| `exitSignals` | `NodeJS.Signals[]` | 见文档 | 触发清理的信号 |
| `clearOnShutdown` | `boolean` | `true` | 关闭时清除渲染区域 |
| `targetFps` | `number` | `30` | 目标帧率 |
| `maxFps` | `number` | `60` | 最大帧率上限 |
| `useMouse` | `boolean` | `true` | 启用鼠标输入 |
| `autoFocus` | `boolean` | `true` | 单击时自动聚焦 |
| `enableMouseMovement` | `boolean` | `true` | 跟踪鼠标移动 |
| `useKittyKeyboard` | `KittyKeyboardOptions \| null` | `{}` | Kitty 键盘协议设置 |
| `backgroundColor` | `ColorInput` | transparent | 渲染缓冲区背景色 |
| `consoleOptions` | `ConsoleOptions` | - | 控制台叠加层配置 |
| `openConsoleOnError` | `boolean` | `true` (dev) | 未捕获错误时打开控制台 |
| `onDestroy` | `() => void` | - | 销毁后回调 |

#### 屏幕模式

- **`"alternate-screen"`**（默认）：切换到终端的备用屏幕缓冲区
- **`"main-screen"`**：在主屏幕上渲染
- **`"split-footer"`**：将渲染器固定在终端底部的保留区域

#### 外部输出模式

- **`"capture-stdout"`**：拦截 `stdout.write`，排队并在 split-footer 渲染时刷新
- **`"passthrough"`**：保持 `stdout.write` 不变

#### 控制台模式

- **`"console-overlay"`**（默认）：捕获 `console.*` 输出并在 TUI 中渲染为可切换面板
- **`"disabled"`**：隐藏并停用叠加层

#### 写入 Scrollback

在 split-footer 模式下，可以使用 `renderer.writeToScrollback(writer)` 向终端回滚区域写入样式化内容。也可以使用 `renderer.createScrollbackSurface(options?)` 创建可流式写入的表面。

#### 根渲染对象

```typescript
renderer.root.add(Box({ width: 40, height: 10, borderStyle: "rounded" },
  Text({ content: "Hello, OpenTUI!" })))
```

根渲染对象填充整个终端，并在调整大小时自动适应。

#### 渲染循环控制

- **自动模式**（默认）：仅在组件树变化时重新渲染
- **连续模式**：调用 `renderer.start()` / `renderer.stop()`
- **实时渲染**：调用 `renderer.requestLive()` / `renderer.dropLive()`
- **暂停和挂起**：`renderer.pause()` / `renderer.suspend()` / `renderer.resume()`

#### 关键属性

| 属性 | 类型 | 描述 |
|------|------|------|
| `root` | `RootRenderable` | 组件树的根 |
| `width` / `height` | `number` | 当前渲染尺寸 |
| `console` | `TerminalConsole` | 内置控制台叠加层 |
| `keyInput` | `KeyHandler` | 键盘输入处理器 |
| `isRunning` / `isDestroyed` | `boolean` | 状态标志 |
| `currentFocusedRenderable` | `Renderable \| null` | 当前聚焦的组件 |
| `screenMode` | `ScreenMode` | 活动屏幕模式（可运行时切换） |
| `themeMode` | `ThemeMode \| null` | 检测到的终端主题（dark/light） |

#### 事件

```typescript
renderer.on("resize", (width, height) => {})
renderer.on("focus", () => {})
renderer.on("blur", () => {})
renderer.on("theme_mode", (mode) => {})
renderer.on("palette", (colors) => {})
renderer.on("capabilities", (caps) => {})
renderer.on("selection", (selection) => {})
renderer.on("destroy", () => {})
```

#### 主题模式检测

```typescript
const mode = renderer.themeMode
renderer.on("theme_mode", (nextMode) => {})
const mode = await renderer.waitForThemeMode(1000)
```

#### 终端集成

```typescript
renderer.setTerminalTitle("My App")
renderer.setBackgroundColor("#0D1117")
renderer.resetTerminalBgColor()
renderer.copyToClipboardOSC52("text")
renderer.setCursorPosition(10, 5, true)
renderer.setCursorStyle({ style: "block", blinking: true })
```

---

### 2.2 Renderables

Renderables 是 UI 的构建块，可使用 Yoga 布局引擎进行定位、样式化和嵌套。

#### 创建 Renderable

```typescript
import { createCliRenderer, TextRenderable, BoxRenderable } from "@opentui/core"

const renderer = await createCliRenderer()
const greeting = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
})
renderer.root.add(greeting)
```

#### 内置 Renderables

| 类 | 描述 |
|------|------|
| `BoxRenderable` | 带边框、背景和布局的容器 |
| `TextRenderable` | 只读样式文本显示 |
| `InputRenderable` | 单行文本输入 |
| `TextareaRenderable` | 多行可编辑文本 |
| `SelectRenderable` | 下拉/列表选择 |
| `TabSelectRenderable` | 水平标签选择 |
| `ScrollBoxRenderable` | 可滚动的容器 |
| `ScrollBarRenderable` | 独立的滚动条控件 |
| `CodeRenderable` | 语法高亮代码显示 |
| `LineNumberRenderable` | 代码/文本视图的行号 gutter |
| `DiffRenderable` | 统一或分屏差异查看器 |
| `ASCIIFontRenderable` | ASCII 艺术字体显示 |
| `FrameBufferRenderable` | 自定义图形的原始帧缓冲区 |
| `MarkdownRenderable` | Markdown 渲染器 |
| `SliderRenderable` | 数值滑块控件 |

#### 渲染树

```typescript
container.add(title)
container.add(body)
container.remove("body")
const child = container.getRenderable("title")
const deep = container.findDescendantById("nested-input")
```

#### 布局属性

```typescript
const panel = new BoxRenderable(renderer, {
  width: 40, height: "50%",
  minWidth: 20, maxHeight: 30,
  flexGrow: 1, flexShrink: 0,
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "flex-start",
  position: "absolute", left: 10, top: 5,
  padding: 2, paddingTop: 1, margin: 1,
})
```

#### 焦点管理

```typescript
input.focus()
input.blur()
console.log(input.focused)

input.on(RenderableEvents.FOCUSED, () => {})
input.on(RenderableEvents.BLURRED, () => {})
```

#### 事件处理

```typescript
// 鼠标事件
new BoxRenderable(renderer, {
  onMouseDown: (event) => {},
  onMouseOver: (event) => {},
  onMouseOut: (event) => {},
  onMouseScroll: (event) => {},
})

// 键盘事件
new InputRenderable(renderer, {
  onKeyDown: (key) => {},
  onPaste: (event) => {},
})
```

#### 其他属性

```typescript
panel.visible = false  // 隐藏
panel.opacity = 0.5   // 半透明
panel.zIndex = 100     // 层级
renderable.translateX = 10  // 偏移
panel.buffered = true  // 离屏渲染
renderable.destroy()   // 销毁
container.destroyRecursively()  // 递归销毁
```

---

### 2.3 Constructs

Constructs 是声明式的组件工厂函数，创建 VNodes（虚拟节点）。

#### 基本用法

```typescript
import { createCliRenderer, Box, Text, Input } from "@opentui/core"

const renderer = await createCliRenderer()
renderer.root.add(
  Box(
    { width: 40, height: 10, borderStyle: "rounded", padding: 1 },
    Text({ content: "Welcome!" }),
    Input({ placeholder: "Enter your name..." }),
  ),
)
```

子组件作为 props 对象后的额外参数传递。

#### 可用 Constructs

```typescript
import { ASCIIFont, Box, Code, FrameBuffer, Input, ScrollBox, Select, TabSelect, Text } from "@opentui/core"

const box = Box({ border: true })
const text = Text({ content: "Hello" })
const input = Input({ placeholder: "Type here..." })
const code = Code({ content: "const x = 1", filetype: "typescript", syntaxStyle })
const scrollBox = ScrollBox({ width: 40, height: 10 })
const frameBuffer = FrameBuffer({ width: 20, height: 10 })
const ascii = ASCIIFont({ text: "OPEN", font: "tiny" })
```

#### 自定义 Construct

```typescript
function LabeledInput(props: { label: string; placeholder: string }) {
  return Box(
    { flexDirection: "row", gap: 1 },
    Text({ content: props.label }),
    Input({ placeholder: props.placeholder, width: 20 }),
  )
}
```

#### 方法链

VNodes 支持方法链——系统会在组件创建后重放这些调用：

```typescript
const input = Input({ id: "my-input", placeholder: "Type here..." })
input.focus()  // 排队等待
input.value = "new value"
renderer.root.add(input)
```

#### delegate() 函数

将外部方法/属性路由到内部子组件：

```typescript
import { delegate, Box, Text, Input } from "@opentui/core"

function LabeledInput(props: { id: string; label: string; placeholder: string }) {
  return delegate(
    { focus: `${props.id}-input`, value: `${props.id}-input` },
    Box(
      { flexDirection: "row" },
      Text({ content: props.label }),
      Input({ id: `${props.id}-input`, placeholder: props.placeholder, width: 20 }),
    ),
  )
}
```

---

### 2.4 Renderables vs Constructs

#### Renderables（命令式）

- 需要 `RenderContext`
- 直接修改实例
- 手动导航访问嵌套组件
- 显式控制组件生命周期

#### Constructs（声明式）

- 实例化前无需 `RenderContext`
- VNodes 排队方法调用
- `delegate()` 将 API 路由到嵌套组件
- React/Solid 风格的声明式语法

#### 何时使用哪种

**使用 Renderables 当**：
- 需要精细控制组件生命周期
- 构建底层自定义组件
- 需要立即访问 renderable 方法
- 性能至关重要，希望避免 VNode 开销

**使用 Constructs 当**：
- 偏好声明式、组合式代码
- 构建高级 UI 组件
- 希望更清晰、更可读的组件定义
- 熟悉 React/Solid 模式

两者可以在同一应用中混合使用。

---

### 2.5 Layout System

OpenTUI 使用 Yoga 布局引擎提供 CSS Flexbox 功能。

#### Flex Direction

```typescript
{ flexDirection: "column" }       // 垂直（默认）
{ flexDirection: "row" }          // 水平
{ flexDirection: "row-reverse" }
{ flexDirection: "column-reverse" }
```

#### Justify Content

```typescript
{ justifyContent: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly" }
```

#### Align Items

```typescript
{ alignItems: "flex-start" | "flex-end" | "center" | "stretch" | "baseline" }
```

#### 尺寸

```typescript
{ width: 30, height: 10 }           // 固定尺寸
{ width: "100%", height: "50%" }    // 百分比
{ flexGrow: 1, flexShrink: 0, flexBasis: 100 }
```

#### 定位

```typescript
{ position: "relative" }  // 默认
{ position: "absolute", left: 10, top: 5, right: 10, bottom: 5 }
```

#### 内边距和外边距

```typescript
{
  padding: 2, paddingX: 4, paddingY: 2,
  paddingTop: 1, paddingRight: 2, paddingBottom: 1, paddingLeft: 2,
  margin: 1, marginX: 3, marginY: 1,
}
```

#### 响应式布局

```typescript
renderer.on("resize", (width, height) => {
  container.flexDirection = width < 80 ? "column" : "row"
})
```

---

### 2.6 Keyboard Input

OpenTUI 解析终端输入并提供结构化按键事件。

#### 基本按键处理

```typescript
import { createCliRenderer, type KeyEvent } from "@opentui/core"

const renderer = await createCliRenderer()
const keyHandler = renderer.keyInput

keyHandler.on("keypress", (key: KeyEvent) => {
  console.log("Key name:", key.name)
  console.log("Sequence:", key.sequence)
  console.log("Ctrl:", key.ctrl)
  console.log("Shift:", key.shift)
  console.log("Alt:", key.meta)
})
```

#### KeyEvent 属性

| 属性 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | 按键名（如 "a", "escape", "f1"） |
| `sequence` | `string` | 原始转义序列 |
| `ctrl` | `boolean` | 是否按住 Ctrl |
| `shift` | `boolean` | 是否按住 Shift |
| `meta` | `boolean` | 是否按住 Alt/Meta |
| `option` | `boolean` | 是否按住 Option（macOS） |

#### 按键别名

- `enter` -> `return`
- `esc` -> `escape`
- 数字小键盘键被别名到主键盘等效键

#### 粘贴事件

```typescript
keyHandler.on("paste", (event: PasteEvent) => {
  const text = new TextDecoder().decode(event.bytes)
})
```

#### Kitty 键盘协议

```typescript
const renderer = await createCliRenderer({
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
    events: true,
    allKeysAsEscapes: false,
    reportText: false,
  },
})
```

---

### 2.7 Console Overlay

内置控制台叠加层捕获所有 `console.*` 调用。

#### 基本用法

```typescript
import { createCliRenderer, ConsolePosition } from "@opentui/core"

const renderer = await createCliRenderer({
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    sizePercent: 30,
  },
})

console.log("这出现在叠加层中")
```

#### 控制台位置

```typescript
ConsolePosition.TOP
ConsolePosition.BOTTOM
ConsolePosition.LEFT
ConsolePosition.RIGHT
```

#### 切换控制台

```typescript
renderer.console.toggle()
```

#### 快捷键绑定

```typescript
renderer.keyInput.on("keypress", (key) => {
  if (key.name === "`") renderer.console.toggle()
})
```

#### 环境变量

```bash
OTUI_USE_CONSOLE=false bun app.ts   # 禁用控制台捕获
SHOW_CONSOLE=true bun app.ts        # 启动时显示控制台
OTUI_DUMP_CAPTURES=true bun app.ts  # 退出时转储捕获输出
```

---

### 2.8 Colors

使用 `RGBA` 类表示颜色。

#### 创建颜色

```typescript
import { RGBA } from "@opentui/core"

// 整数 (0-255)
const red = RGBA.fromInts(255, 0, 0, 255)

// 浮点值 (0.0-1.0)
const green = RGBA.fromValues(0.0, 1.0, 0.0, 1.0)

// 十六进制字符串
const purple = RGBA.fromHex("#800080")

// 默认前景/背景
const fg = RGBA.defaultForeground()
const bg = RGBA.defaultBackground()

// 索引颜色
const ansiRed = RGBA.fromIndex(1)
const ansiBrightBlue = RGBA.fromIndex(12)
```

#### 字符串颜色

```typescript
Text({ content: "Hello", fg: "#00FF00" })
Box({ backgroundColor: "red", borderColor: "white" })
Box({ backgroundColor: "transparent" })
```

#### parseColor 工具

```typescript
import { parseColor } from "@opentui/core"
const color = parseColor("#FF0000")
```

#### 颜色意图

每个 `RGBA` 值存储颜色意图：
- `rgb`：字面 RGB 颜色
- `default`：终端默认前景/背景
- `indexed`：索引 ANSI 颜色

#### 终端调色板检测

```typescript
const colors = await renderer.getPalette({ size: 256 })
console.log(colors.palette[1])
console.log(colors.defaultForeground, colors.defaultBackground)
```

#### Alpha 混合

```typescript
canvas.frameBuffer.setCellWithAlphaBlending(10, 5, " ",
  RGBA.fromValues(0, 0, 0, 0),
  RGBA.fromValues(1.0, 0.0, 0.0, 0.5))
```

#### 文本属性与颜色

```typescript
import { TextAttributes } from "@opentui/core"
const styledText = new TextRenderable(renderer, {
  content: "Important",
  fg: RGBA.fromHex("#FFFF00"),
  bg: RGBA.fromHex("#333333"),
  attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
})
```

可用的文本属性：
- `TextAttributes.BOLD`、`TextAttributes.DIM`、`TextAttributes.ITALIC`
- `TextAttributes.UNDERLINE`、`TextAttributes.BLINK`
- `TextAttributes.INVERSE`、`TextAttributes.HIDDEN`、`TextAttributes.STRIKETHROUGH`

---

### 2.9 Lifecycle and Cleanup

OpenTUI 让你控制终端清理。调用 `renderer.destroy()` 恢复终端状态。

#### 为何需要手动清理

OpenTUI 不会在 `process.exit` 或未捕获错误时自动清理，以便你更好地控制关闭行为。

#### 基本清理

```typescript
const renderer = await createCliRenderer()
try {
  // ... 应用代码 ...
} catch (error) {
  process.exitCode = 1
} finally {
  renderer.destroy()
}
```

#### 信号处理

默认处理的信号：`SIGINT`, `SIGTERM`, `SIGQUIT`, `SIGABRT`, `SIGHUP`, `SIGBREAK`, `SIGPIPE`, `SIGBUS`。

```typescript
// 自定义信号
const renderer = await createCliRenderer({
  exitSignals: ["SIGINT", "SIGTERM"],
})
```

#### Ctrl+C 行为

```typescript
const renderer = await createCliRenderer({
  exitOnCtrlC: false,
})
```

#### 销毁回调

```typescript
const renderer = await createCliRenderer({
  onDestroy: () => { console.log("清理完成") },
})
```

#### destroy() 清理的内容

- 移除 OpenTUI 添加的信号和进程监听器
- 清除定时器和渲染循环
- 销毁渲染树中的所有 renderable
- 恢复 stdin 原始模式
- 重置终端状态
- 释放原生资源

---

## 3. Plugin API（插件 API）

### 3.1 Plugin Slots

插件槽允许宿主应用定义布局中的命名位置，插件可在运行时为其提供 UI。

#### 核心概念

- **宿主**：定义槽名称和槽 prop 类型
- **插件**：提供一个或多个槽渲染回调，可包含生命周期钩子
- **注册表**：注册插件并为槽解析贡献
- **槽模式**：控制插件输出和后备 UI 的组合方式

#### 定义槽和宿主上下文

```typescript
import type { PluginContext } from "@opentui/core"

type AppSlots = {
  statusbar: { user: string }
  sidebar: { section: "left" | "right" }
}

interface AppContext extends PluginContext {
  appName: string
  version: string
}
```

#### 创建注册表

```typescript
import { createSlotRegistry } from "@opentui/core"

const context = { appName: "my-app", version: "1.0.0" }
const registry = createSlotRegistry<string, AppSlots, typeof context>(renderer, "my-app:plugins", context)
```

#### 槽模式

| 模式 | 行为 |
|------|------|
| `append` | 先显示后备，然后全部插件输出（默认） |
| `replace` | 仅插件输出；无插件输出时显示后备 |
| `single_winner` | 只显示第一个插件；如果无输出则显示后备 |

#### 注册插件

```typescript
const unregister = registry.register({
  id: "clock-plugin",
  order: 0,
  setup(ctx, renderer) {},
  dispose() {},
  slots: {
    statusbar(ctx, props) {
      return `${ctx.appName}:${props.user}`
    },
  },
})
```

#### 插件接口

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `id` | `string` | 是 | 唯一标识符 |
| `order` | `number` | 否 | 排序优先级，默认 0 |
| `setup` | `(ctx, renderer) => void` | 否 | 注册时调用一次 |
| `dispose` | `() => void` | 否 | 插件注销时调用 |
| `slots` | `{ [name]: (ctx, props) => TNode }` | 是 | 槽渲染回调 |

---

### 3.2 Core Slots

核心（无框架）的插件槽 API。

#### 创建注册表

```typescript
import { createCoreSlotRegistry, registerCorePlugin, SlotRenderable } from "@opentui/core"

const registry = createCoreSlotRegistry<Slots, typeof context, SlotData>(renderer, context)
```

#### SlotRenderable

```typescript
const slot = new SlotRenderable(renderer, {
  id: "statusbar-slot",
  registry,
  name: "statusbar",
  data: { label: "ok" },
  mode: "append",
  width: "100%",
  height: 3,
  fallback: () => new TextRenderable(renderer, { id: "fallback", content: "fallback" }),
})
```

#### 托管槽贡献

```typescript
registerCorePlugin(registry, {
  id: "managed-plugin",
  slots: {
    statusbar: {
      render(_ctx, data) { return new TextRenderable(renderer, { id: "managed", content: "managed" }) },
      onActivate(ctx) {},
      onDeactivate(ctx) {},
      onDispose(ctx) {},
    },
  },
})
```

---

### 3.3 React Slots

React 集成插件槽。

```typescript
import { createReactSlotRegistry, Slot } from "@opentui/react"

const registry = createReactSlotRegistry<Slots, typeof context>(renderer, context)
const AppSlot = Slot<Slots, typeof context>

function App() {
  return (
    <AppSlot registry={registry} name="statusbar" user="sam" mode="replace">
      <text>fallback-statusbar</text>
    </AppSlot>
  )
}
```

---

### 3.4 Solid Slots

Solid 集成插件槽。

```typescript
import { createSolidSlotRegistry, Slot } from "@opentui/solid"

const registry = createSolidSlotRegistry<Slots, typeof context>(renderer, context)
const AppSlot = Slot<Slots, typeof context>

const App = () => (
  <AppSlot registry={registry} name="statusbar" user="sam" mode="replace">
    <text>fallback-statusbar</text>
  </AppSlot>
)
```

---

## 4. Components（组件）

### 4.1 Text

显示带有颜色、属性和文本选择的样式化文本内容。

```typescript
// Renderable API
const text = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello!",
  fg: "#00FF00",
})

// Construct API
Text({ content: "Hello!", fg: "#00FF00" })
```

**文本属性**：`BOLD`, `DIM`, `ITALIC`, `UNDERLINE`, `BLINK`, `INVERSE`, `HIDDEN`, `STRIKETHROUGH`。

**模板文字**：

```typescript
import { t, bold, underline, fg, bg, italic } from "@opentui/core"
Text({ content: t`${bold("Important:")} ${fg("#FF0000")(underline("Warning!"))}` })
```

**属性**：`content`, `fg`, `bg`, `attributes`, `selectable`, `position`, `left`, `top`, `right`, `bottom`。

---

### 4.2 Box

带边框、背景颜色和布局能力的容器。

```typescript
// Renderable API
new BoxRenderable(renderer, { id: "panel", width: 30, height: 10, borderStyle: "rounded" })

// Construct API
Box({ width: 30, height: 10, borderStyle: "rounded" }, Text({ content: "Inside" }))
```

**边框样式**：`"single"`, `"double"`, `"rounded"`, `"heavy"`。

**标题**：

```typescript
Box({ title: "Settings", titleAlignment: "center", bottomTitle: "Footer" })
```

**鼠标事件**：`onMouseDown`, `onMouseOver`, `onMouseOut`。

**属性**：`width`, `height`, `backgroundColor`, `border`, `borderStyle`, `borderColor`, `title`, `titleAlignment`, `padding`, `gap`, `flexDirection`, `justifyContent`, `alignItems`。

---

### 4.3 Input

带光标、占位文本和焦点状态的文本输入字段。

```typescript
// Renderable API
const input = new InputRenderable(renderer, { width: 25, placeholder: "Enter name..." })
input.focus()

// Construct API
const input = Input({ placeholder: "Enter name...", width: 25 })
input.focus()
```

**事件**：`InputRenderableEvents.INPUT`, `CHANGE`, `ENTER`。

**属性**：`width`, `value`, `placeholder`, `maxLength`, `backgroundColor`, `focusedBackgroundColor`, `textColor`, `cursorColor`。

---

### 4.4 Textarea

多行文本输入，带光标、选择和丰富键绑定。

```typescript
const textarea = new TextareaRenderable(renderer, {
  id: "notes",
  width: 50,
  height: 6,
  placeholder: "Type notes here...",
  backgroundColor: "#1a1a1a",
  focusedBackgroundColor: "#222222",
  textColor: "#FFFFFF",
  cursorColor: "#00FF88",
})
textarea.focus()
```

**提交处理**：

```typescript
new TextareaRenderable(renderer, {
  onSubmit: () => { console.log("Submitted:", textarea.plainText) },
  keyBindings: [{ name: "return", ctrl: true, action: "submit" }],
})
```

**属性和方法**：
- `plainText`, `cursorOffset`, `logicalCursor`, `visualCursor`
- `setCursor()`, `moveCursorLeft/Right/Up/Down()`, `moveWordForward()`
- `setSelection()`, `selectAll()`, `clearSelection()`, `deleteSelection()`
- `insertChar()`, `insertText()`, `deleteChar()`, `undo()`, `redo()`
- `traits` 属性：编辑器特性（`capture`, `suspend`, `status`）

**换行模式**：`"none"`, `"char"`, `"word"`。

---

### 4.5 Select

垂直列表选择组件。

```typescript
const menu = new SelectRenderable(renderer, {
  width: 30, height: 8,
  options: [
    { name: "New File", description: "Create a new file" },
    { name: "Open File", description: "Open an existing file" },
  ],
})
menu.focus()
```

**键盘导航**：`Up/k`（上移）、`Down/j`（下移）、`Shift+Up/Down`（快滚 5 项）、`Enter`（选择）。

**事件**：`SelectRenderableEvents.ITEM_SELECTED`, `SELECTION_CHANGED`。

**属性**：`selectedIndex`, `showDescription`, `showScrollIndicator`, `wrapSelection`, `itemSpacing`, `fastScrollStep`, `selectedBackgroundColor` 等。

**程序化控制**：`getSelectedIndex()`, `getSelectedOption()`, `setSelectedIndex()`, `moveUp()`, `moveDown()`, `selectCurrent()`。

---

### 4.6 TabSelect

水平标签选择组件。

```typescript
const tabs = new TabSelectRenderable(renderer, {
  width: 60,
  options: [
    { name: "Home", description: "Dashboard" },
    { name: "Files", description: "File management" },
  ],
  tabWidth: 20,
})
tabs.focus()
```

**键盘导航**：`Left/[`（上一个）、`Right/]`（下一个）、`Enter`（选择）。

**属性**：`tabWidth`, `showScrollArrows`, `showDescription`, `showUnderline`, `wrapSelection`。

---

### 4.7 ScrollBox

支持水平和垂直滚动的可滚动容器。

```typescript
const scrollbox = new ScrollBoxRenderable(renderer, {
  id: "scrollbox", width: 40, height: 20,
})
```

**粘性滚动**：

```typescript
new ScrollBoxRenderable(renderer, {
  stickyScroll: true, stickyStart: "bottom",
})
```

**属性**：`scrollX`, `scrollY`, `stickyScroll`, `viewportCulling`, 自定义滚动条选项。

**滚动方法**：`scrollBy()`, `scrollTo()`, `scrollChildIntoView("id")`。

---

### 4.8 ScrollBar

独立的滚动条组件。

```typescript
const scrollbar = new ScrollBarRenderable(renderer, {
  orientation: "vertical", height: 10, showArrows: true,
})
scrollbar.scrollSize = 200
scrollbar.viewportSize = 20
scrollbar.scrollPosition = 0
```

**属性**：`orientation`, `showArrows`, `scrollSize`, `viewportSize`, `scrollPosition`, `scrollStep`, `onChange`。

---

### 4.9 Slider

用于连续值的可拖动滑块。

```typescript
new SliderRenderable(renderer, {
  orientation: "horizontal", width: 30, height: 1,
  min: 0, max: 100, value: 25,
  onChange: (value) => {},
})
```

**属性**：`orientation`, `value`, `min`, `max`, `viewPortSize`, `backgroundColor`, `foregroundColor`。

---

### 4.10 Code

使用 Tree-sitter 显示语法高亮的代码。

```typescript
const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
  string: { fg: RGBA.fromHex("#A5D6FF") },
  comment: { fg: RGBA.fromHex("#8B949E"), italic: true },
  default: { fg: RGBA.fromHex("#E6EDF3") },
})

const code = new CodeRenderable(renderer, {
  id: "code", content: `const x = 1`, filetype: "javascript",
  syntaxStyle, width: 50, height: 10,
})
```

**流式模式**：

```typescript
new CodeRenderable(renderer, {
  content: "", filetype: "typescript", syntaxStyle, streaming: true,
})
```

**属性**：`content`, `filetype`, `syntaxStyle`, `streaming`, `conceal`, `selectable`, `lineCount`, `scrollY`, `scrollX`, `isHighlighting`, `plainText`。

---

### 4.11 Markdown

渲染 Markdown 内容。

```typescript
const markdown = new MarkdownRenderable(renderer, {
  id: "readme", width: 60,
  content: "# Hello\n\n- One\n- Two\n\n```ts\nconst x = 1\n```",
  syntaxStyle,
})
```

**属性**：`content`, `syntaxStyle`, `conceal`, `concealCode`, `streaming`, `tableOptions`, `internalBlockMode`。

**表格选项**：`style`（`"grid"` 或 `"columns"`）、`widthMode`、`columnFitter`、`wrapMode`、`cellPadding`、`borders`、`borderStyle` 等。

---

### 4.12 Line Numbers

为支持行信息的 renderable 添加行号 gutter。

```typescript
const lineNumbers = new LineNumberRenderable(renderer, {
  id: "code-lines",
  target: code,
  minWidth: 3,
  paddingRight: 1,
  fg: "#6b7280",
  bg: "#161b22",
})
```

**方法**：`setLineColor()`, `clearLineColor()`, `setLineSign()`, `clearLineSign()`, `setLineNumbers()`, `setHideLineNumbers()`。

**属性**：`target`, `fg`, `bg`, `minWidth`, `paddingRight`, `lineNumberOffset`, `showLineNumbers`。

---

### 4.13 FrameBuffer

用于自定义图形的底层渲染表面。

```typescript
const canvas = new FrameBufferRenderable(renderer, { id: "canvas", width: 50, height: 20 })

// 绘图方法
canvas.frameBuffer.setCell(x, y, char, fg, bg)
canvas.frameBuffer.setCellWithAlphaBlending(x, y, char, fg, bg)
canvas.frameBuffer.drawText("Hello", x, y, fg)
canvas.frameBuffer.fillRect(x, y, w, h, color)
canvas.frameBuffer.drawFrameBuffer(destX, destY, source)
canvas.frameBuffer.colorMatrix(matrix, mask, strength, target)
canvas.frameBuffer.colorMatrixUniform(matrix, strength, target)
```

**预定义矩阵**：`INVERT_MATRIX`, `SEPIA_MATRIX`。

---

### 4.14 ASCIIFont

使用多种字体样式显示 ASCII 艺术文字。

```typescript
const title = new ASCIIFontRenderable(renderer, {
  id: "title", text: "OPENTUI", font: "huge",
  color: RGBA.fromInts(255, 255, 255, 255),
})
```

**可用字体**：`"tiny"`, `"block"`, `"shade"`, `"slick"`, `"huge"`, `"grid"`, `"pallet"`。

---

### 4.15 Diff

渲染统一或分屏差异。

```typescript
const diff = new DiffRenderable(renderer, {
  id: "diff", width: "100%", height: 16,
  diff: `--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-const a = 1\n+const a = 2`,
  view: "split", filetype: "typescript",
  syntaxStyle, showLineNumbers: true,
})
```

**属性**：`diff`, `view`（`"unified"` 或 `"split"`）、`syncScroll`, `filetype`, `showLineNumbers`, `addedBg`, `removedBg`, `contextBg` 等。

---

## 5. Bindings（框架绑定）

### 5.1 Solid.js

使用 Solid.js 的细粒度响应式构建终端 UI。

#### 安装

```bash
bun install solid-js @opentui/solid
```

#### TypeScript 配置

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

#### Bun 配置（bunfig.toml）

```toml
preload = ["@opentui/solid/preload"]
```

#### 渲染

```typescript
import { render } from "@opentui/solid"

const App = () => <text>Hello, World!</text>
render(App)
```

#### 组件

- 布局：`<text>`, `<box>`, `<scrollbox>`, `<ascii_font>`, `<markdown>`
- 输入：`<input>`, `<textarea>`, `<select>`, `<tab_select>`
- 代码：`<code>`, `<line_number>`, `<diff>`
- 文本修饰：`<span>`, `<strong>`, `<b>`, `<em>`, `<i>`, `<u>`, `<br>`, `<a>`

#### API

```typescript
render(() => <App />, rendererOrConfig?)
testRender(() => <App />, { width: 40, height: 10 })
extend({ custom_box: CustomBoxRenderable })
```

#### 钩子

```typescript
useRenderer()                              // 访问 renderer 实例
useKeyboard((key) => {}, { release: true }) // 键盘事件
onResize((width, height) => {})             // 终端调整大小
onFocus(() => {})                           // 终端获得焦点
onBlur(() => {})                            // 终端失去焦点
useTerminalDimensions()                     // 响应式终端尺寸
usePaste((event) => {})                     // 粘贴事件
useSelectionHandler((sel) => {})            // 文本选择
useTimeline({ duration: 2000 })             // 动画
```

#### 特殊组件

```typescript
<Portal mount={renderer.root}>...</Portal>   // 渲染到不同挂载点
<Dynamic component={isMultiline() ? "textarea" : "input"} />  // 动态组件
```

#### Scrollback 写入

```typescript
writeSolidToScrollback(renderer, () => <text fg="#8BD5CA">响应</text>)
createScrollbackWriter(() => <text>日志</text>, { startOnNewLine: true })
```

---

### 5.2 React

使用 React 构建终端 UI。

#### 安装

```bash
bun install @opentui/react @opentui/core react
```

#### 快速开始

```typescript
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
  return <text>Hello, world!</text>
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

#### 组件

- 布局：`<text>`, `<box>`, `<scrollbox>`, `<ascii-font>`, `<markdown>`
- 输入：`<input>`, `<textarea>`, `<select>`, `<tab-select>`
- 代码：`<code>`, `<line-number>`, `<diff>`
- 文本修饰：`<span>`, `<strong>`, `<b>`, `<em>`, `<i>`, `<u>`, `<br>`, `<a>`

#### 钩子

```typescript
useRenderer()
useKeyboard((key) => {}, { release: true })
useOnResize((width, height) => {})
useTerminalDimensions()  // 返回 { width, height }
useTimeline({ duration: 2000, loop: false })
```

#### React DevTools

```bash
bun add --dev react-devtools-core@7
npx react-devtools@7
DEV=true bun run your-app.ts
```

#### 组件扩展

```typescript
import { extend } from "@opentui/react"
extend({ customBox: CustomBoxRenderable })
```

---

## 6. Keymap（按键映射引擎）

### 6.1 Overview

OpenTUI Keymap 是一个与宿主无关的绑定引擎，支持分层快捷键、可发现命令和序列处理。

#### 安装

```bash
bun install @opentui/keymap
```

#### 入口包

| 包 | 描述 |
|------|------|
| `@opentui/keymap` | 裸引擎：`Keymap`、键字符串化器、类型 |
| `@opentui/keymap/addons` | 通用插件（解析器、诊断、序列） |
| `@opentui/keymap/addons/opentui` | OpenTUI 专用插件 |
| `@opentui/keymap/opentui` | OpenTUI 宿主适配器 |
| `@opentui/keymap/html` | DOM 宿主适配器 |
| `@opentui/keymap/react` | React Provider 和钩子 |
| `@opentui/keymap/solid` | Solid Provider 和钩子 |

#### 基本绑定

```typescript
[
  { key: "x", cmd: "save-file" },
  { key: "ctrl+x", cmd: "cut" },
  { key: "dd", cmd: "delete-line" },
  { key: "<leader>s", cmd: ":write session.log" },
  { key: "?", cmd: "toggle-help" },
  { key: "escape", event: "release", cmd: "close-help" },
  { key: { name: "return", ctrl: true }, cmd: "submit" },
]
```

#### 三层 API

1. **注册**：`registerLayer()`, `registerToken()`, 插件
2. **调度**：匹配键、解析歧义、运行命令
3. **查询**：`getActiveKeys()`, `getCommands()`, `getPendingSequence()`

---

### 6.2 Hosts

宿主适配器将运行时的焦点模型、层次结构和按键事件适配到 Keymap。

#### OpenTUI 宿主

```typescript
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"

const renderer = await createCliRenderer()
const keymap = createDefaultOpenTuiKeymap(renderer)

keymap.registerLayer({
  commands: [{ name: "quit", run() { renderer.destroy() } }],
  bindings: [{ key: "q", cmd: "quit" }],
})
```

#### HTML 宿主

```typescript
import { createDefaultHtmlKeymap } from "@opentui/keymap/html"

const root = document.getElementById("app")!
const keymap = createDefaultHtmlKeymap(root)

keymap.registerLayer({
  commands: [{ name: "toggle-help", run() {} }],
  bindings: [{ key: "?", cmd: "toggle-help" }],
})
```

---

### 6.3 Core

裸引擎 API。

#### 构造

```typescript
import { Keymap, type KeymapHost } from "@opentui/keymap"
const keymap = new Keymap(host as KeymapHost<object>)
```

#### 层

```typescript
keymap.registerLayer({
  target: editor,
  targetMode: "focus-within",
  priority: 10,
  commands: [{ name: "save-file", run() {} }],
  bindings: [{ key: "ctrl+s", cmd: "save-file" }],
})
```

#### 绑定

| 形式 | 示例 | 说明 |
|------|------|------|
| 字符串按键 | `"x"`, `"ctrl+x"` | 需要已注册的绑定解析器 |
| 字符串序列 | `"dd"`, `"<leader>s"` | 连接的多键序列 |
| 对象形式 | `{ name: "return", ctrl: true }` | 跳过字符串解析 |

#### 查询方法

```typescript
keymap.getActiveKeys(options?)
keymap.getPendingSequence()
keymap.getCommands(query?)
keymap.getCommandEntries(query?)
keymap.getCommandBindings(query)
keymap.runCommand("save-file")
keymap.dispatchCommand("save-file")
```

#### 事件

```typescript
keymap.on("state", () => {})               // 衍生状态变化
keymap.on("pendingSequence", (seq) => {})  // 待定序列更新
keymap.on("warning", (event) => {})        // 警告
keymap.on("error", (event) => {})          // 错误
```

---

### 6.4 React

React 键绑定集成。

```typescript
import { KeymapProvider, useBindings, useActiveKeys } from "@opentui/keymap/react"

function App() {
  useBindings(() => ({
    commands: [{ name: "quit", run() { renderer.destroy() } }],
    bindings: [{ key: "q", cmd: "quit" }],
  }), [])

  return <text>Press q to quit</text>
}

createRoot(renderer).render(
  <KeymapProvider keymap={keymap}>
    <App />
  </KeymapProvider>,
)
```

**钩子**：`useKeymap()`, `useBindings()`, `useActiveKeys()`, `usePendingSequence()`, `reactiveMatcherFromStore()`。

---

### 6.5 Solid

Solid 键绑定集成。

```typescript
import { KeymapProvider, useBindings, useKeymapSelector } from "@opentui/keymap/solid"

function App() {
  useBindings(() => ({
    commands: [{ name: "quit", run() { renderer.destroy() } }],
    bindings: [{ key: "q", cmd: "quit" }],
  }))

  return <text>Press q to quit</text>
}

render(() => (
  <KeymapProvider keymap={keymap}>
    <App />
  </KeymapProvider>
), renderer)
```

**钩子**：`useKeymap()`, `useBindings()`, `useKeymapSelector()`, `reactiveMatcherFromSignal()`。

---

### 6.6 Built-in Addons

内置插件包。

**通用插件**：
- `registerDefaultKeys()` - 默认键解析器和事件匹配器
- `registerEnabledFields()` - `enabled` 字段
- `registerMetadataFields()` - 元数据字段（`desc`, `title`, `category`）
- `registerBindingOverrides()` - 绑定覆盖
- `registerCommaBindings()` - 逗号分隔的多个绑定
- `registerEmacsBindings()` - Emacs 风格的空格和弦
- `registerLeader()` - `<leader>` 令牌
- `registerBackspacePopsPendingSequence()` - Backspace 回退
- `registerEscapeClearsPendingSequence()` - Escape 取消
- `registerNeovimDisambiguation()` - 超时消歧
- `registerDeadBindingWarnings()` - 死绑定警告
- `registerUnresolvedCommandWarnings()` - 未解析命令警告
- `registerExCommands()` - Ex 命令（`:write`）

**OpenTUI 专用插件**：
- `registerBaseLayoutFallback()` - 键盘布局回退
- `createTextareaBindings()` - 生成文本区域绑定
- `registerEditBufferCommands()` - 编辑缓冲区命令
- `registerTextareaMappingSuspension()` - 暂停文本区域映射
- `registerManagedTextareaLayer()` - 高级文本区域集成

---

### 6.7 Custom Addons

自定义插件开发。

```typescript
export function registerModeField<TTarget extends object, TEvent extends KeymapEvent>(
  keymap: Keymap<TTarget, TEvent>,
): () => void {
  const offField = keymap.registerBindingFields({
    mode(value, ctx) {
      ctx.require("app.mode", value)
      ctx.attr("mode", value)
    },
  })
  return offField
}
```

**公共注册 API**：`registerToken()`, `registerLayerFields()`, `registerBindingFields()`, `registerCommandFields()`, `prepend/appendBindingParser()`, `prepend/appendCommandResolver()`, `intercept()` 等。

---

## 7. Reference（参考）

### 7.1 Environment Variables

| 变量 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `OTUI_TS_STYLE_WARN` | `string` | `false` | 缺失语法样式的警告 |
| `OTUI_TREE_SITTER_WORKER_PATH` | `string` | `""` | Tree-sitter worker 路径 |
| `OTUI_PALETTE_IDLE_TIMEOUT_MS` | `number` | `300` | 调色板查询后静默超时 |
| `OTUI_DEBUG_FFI` | `boolean` | `false` | FFI 绑定调试日志 |
| `OTUI_TRACE_FFI` | `boolean` | `false` | FFI 绑定跟踪 |
| `OPENTUI_FORCE_WCWIDTH` | `boolean` | `false` | 使用 wcwidth 计算字符宽度 |
| `OPENTUI_FORCE_UNICODE` | `boolean` | `false` | 强制 Unicode 支持 |
| `OPENTUI_GRAPHICS` | `boolean` | `true` | Kitty 图形协议检测 |
| `OTUI_USE_CONSOLE` | `boolean` | `true` | 全局 console.* 捕获 |
| `SHOW_CONSOLE` | `boolean` | `false` | 启动时打开控制台叠加层 |
| `OTUI_DUMP_CAPTURES` | `boolean` | `false` | 退出时转储捕获内容 |
| `OTUI_NO_NATIVE_RENDER` | `boolean` | `false` | 跳过原生渲染器 |
| `OTUI_DEBUG` | `boolean` | `false` | 捕获所有原始 stdin 输入 |

---

### 7.2 Tree-sitter

Tree-sitter 集成用于快速准确的语法高亮。

#### 添加解析器

```typescript
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"

addDefaultParsers([{
  filetype: "python",
  wasm: "https://.../tree-sitter-python.wasm",
  queries: { highlights: ["https://.../highlights.scm"] },
}])

const client = getTreeSitterClient()
await client.initialize()
```

#### 每客户端解析器

```typescript
const client = new TreeSitterClient({ dataPath: "./cache" })
await client.initialize()
client.addFiletypeParser({ filetype: "rust", wasm: "...", queries: { highlights: [...] } })
```

#### 解析器配置

```typescript
interface FiletypeParserOptions {
  filetype: string
  aliases?: string[]
  wasm: string
  queries: { highlights: string[], injections?: string[] }
  injectionMapping?: { nodeTypes?: Record<string, string>, infoStringMap?: Record<string, string> }
}
```

#### 文件类型解析

```typescript
import { pathToFiletype, extToFiletype, infoStringToFiletype, extensionToFiletype, basenameToFiletype } from "@opentui/core"
extensionToFiletype.set("templ", "html")
basenameToFiletype.set("mytoolrc", "yaml")
```

---

### 7.3 Color Matrix

FrameBuffer 支持原生 4x4 RGBA 矩阵变换。

#### API

```typescript
frameBuffer.colorMatrix(matrix: Float32Array, cellMask: Float32Array, strength = 1.0, target = TargetChannel.Both)
frameBuffer.colorMatrixUniform(matrix: Float32Array, strength = 1.0, target = TargetChannel.Both)
```

#### 矩阵格式

16 个浮点数，行主序，每行定义一个输出通道：
```
Row 0: [r->r, g->r, b->r, a->r]  // 输出红色
Row 1: [r->g, g->g, b->g, a->g]  // 输出绿色
Row 2: [r->b, g->b, b->b, a->b]  // 输出蓝色
Row 3: [r->a, g->a, b->a, a->a]  // 输出 Alpha
```

#### 目标通道

```typescript
TargetChannel.FG   // 仅前景
TargetChannel.BG   // 仅背景
TargetChannel.Both // 前景+背景
```

#### 示例

```typescript
import { INVERT_MATRIX, SEPIA_MATRIX, TargetChannel } from "@opentui/core"

// 反转整个缓冲区
frameBuffer.colorMatrixUniform(INVERT_MATRIX, 1.0, TargetChannel.Both)

// 选择性 sepia
const cellMask = new Float32Array([5, 2, 1.0, 6, 2, 0.5])
frameBuffer.colorMatrix(SEPIA_MATRIX, cellMask, 1.0, TargetChannel.FG)
```

---

> 本文档基于 https://opentui.com/docs/ 官方文档整理。更多信息请参阅官方文档。
