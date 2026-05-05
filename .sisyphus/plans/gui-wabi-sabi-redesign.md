# GUI 侘寂扁平化改版 实施计划

> **For agentic workers:** Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **设计文档:** `.sisyphus/drafts/gui-redesign.md`

**Goal:** 将 ModuleAgent Electron 应用全部 10 个 Vue 组件重写为日式侘寂 (Wabi-sabi) 扁平化风格：低饱和大地色系、极简阴影、克制动效、充分留白。统一 Element Plus `--el-*` 变量体系，支持亮/暗双主题。

**Architecture:** 核心改动分三层：(1) 新建全局主题 CSS 文件覆盖 Element Plus `--el-*` 变量为侘寂色值，注入 main.ts；(2) 逐个重写 10 个组件 `<style scoped>` 块，用 `--el-*` 替换自定义变量 `--bg`/`--surface`/`--accent` 等；(3) MainView 布局重构：FAB 浮动按钮 → 顶部固定工具栏。

**Tech Stack:** Vue 3 SFC + Element Plus 2.13.7 + Pure CSS (no preprocessor)

**Verification Gate:** `npm run typecheck` + `npm run build:electron` + manual visual inspection

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/renderer/src/styles/wabi-sabi.css` | **新建** | 全局主题变量：`:root` 亮色 + `html.dark` 暗色侘寂 `--el-*` 覆盖 |
| `src/renderer/src/main.ts` | 修改 | 导入 `wabi-sabi.css`（在 Element Plus CSS 之后） |
| `src/renderer/src/views/MainView.vue` | 修改 | 工具栏重构 + 状态栏重写 |
| `src/renderer/src/components/SVGTree.vue` | 修改 | 节点/边线/Agent 状态点重写 |
| `src/renderer/src/components/DrawerPanel.vue` | 修改 | 面板去阴影、统一内边距 |
| `src/renderer/src/components/StreamArea.vue` | 修改 | 三段统一边框 + 合并背景 |
| `src/renderer/src/components/ContextCards.vue` | 修改 | 卡片分割线、徽章 CSS 变量化 |
| `src/renderer/src/components/ChatInput.vue` | 修改 | 输入框 focus 样式 |
| `src/renderer/src/views/SetupView.vue` | 修改 | 卡片阴影/圆角、输入框 focus |
| `src/renderer/src/components/SettingsDialog.vue` | 修改 | 同上 + 对话框头 |
| `src/renderer/src/components/ThemeToggle.vue` | 修改 | 按钮类型改 text |
| `src/renderer/src/components/MessageModal.vue` | 修改 | 弹窗阴影/圆角、徽章变量化 |

---

## TODOs

### Task 1: 新建全局侘寂主题 CSS 文件

**Files:**
- Create: `src/renderer/src/styles/wabi-sabi.css`

- [x] **Step 1: 创建 `src/renderer/src/styles/` 目录并写入主题 CSS**

目录已存在则跳过 mkdir。写入文件内容：

```css
/* ============================================================
   ModuleAgent — 侘寂 (Wabi-sabi) 主题
   统一 Element Plus --el-* CSS 变量体系
   亮色 (和纸/陶土) + 暗色 (墨/煤竹) 双主题
   ============================================================ */

/* ── 亮色主题：和纸/陶土基调 ── */
:root {
  /* 背景层级 */
  --el-bg-color-page: #f5f0e8;
  --el-bg-color: #ede6db;
  --el-bg-color-overlay: #faf7f2;
  --el-fill-color: #ede6db;
  --el-fill-color-light: #f0ebe2;
  --el-fill-color-lighter: #f5f1ea;
  --el-fill-color-blank: #faf7f2;

  /* 边框 */
  --el-border-color: #d9cfc2;
  --el-border-color-light: #e3dbd0;
  --el-border-color-lighter: #ede6db;
  --el-border-color-dark: #c4b8a8;

  /* 文字 */
  --el-text-color-primary: #3d3228;
  --el-text-color-regular: #5c4f42;
  --el-text-color-secondary: #8c7b6b;
  --el-text-color-placeholder: #b5a692;

  /* 主色 — 苔色 (sage) */
  --el-color-primary: #7d8c73;
  --el-color-primary-light-3: #97a38e;
  --el-color-primary-light-5: #acb6a5;
  --el-color-primary-light-7: #c2c9bc;
  --el-color-primary-light-8: #cdd3c8;
  --el-color-primary-light-9: #d9ded5;
  --el-color-primary-dark-2: #6b7a62;

  /* 成功 — 若草色 */
  --el-color-success: #7a9e7e;
  --el-color-success-light-3: #95b198;
  --el-color-success-light-5: #aac1ad;
  --el-color-success-light-7: #c1d2c3;
  --el-color-success-light-8: #cddbcf;
  --el-color-success-light-9: #d9e4da;

  /* 警告 — 黄土色 */
  --el-color-warning: #c49b6a;
  --el-color-warning-light-3: #d0af88;
  --el-color-warning-light-5: #dac1a2;
  --el-color-warning-light-7: #e5d3bd;
  --el-color-warning-light-8: #ebdccb;
  --el-color-warning-light-9: #f0e5d8;

  /* 危险 — 弁柄色 */
  --el-color-danger: #c4786a;
  --el-color-danger-light-3: #d09388;
  --el-color-danger-light-5: #daaaa2;
  --el-color-danger-light-7: #e5c3bd;
  --el-color-danger-light-8: #ebcfcb;
  --el-color-danger-light-9: #f0dcd9;

  /* 信息 — 蓝鼠色 */
  --el-color-info: #8b9dad;
  --el-color-info-light-3: #a2b1bd;
  --el-color-info-light-5: #b5c1cb;
  --el-color-info-light-7: #cad3da;
  --el-color-info-light-8: #d5dce2;
  --el-color-info-light-9: #e0e5e9;

  /* 通用 */
  --el-border-radius-base: 8px;
  --el-border-radius-small: 6px;
  --el-box-shadow-light: 0 1px 3px rgba(0, 0, 0, 0.08);
  --el-box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);

  /* 语义色 (element-plus 内部可能需要) */
  --el-color-white: #faf7f2;
  --el-color-black: #3d3228;
}

/* ── 暗色主题：墨/煤竹基调 ── */
html.dark {
  /* 背景层级 */
  --el-bg-color-page: #2a241e;
  --el-bg-color: #342e27;
  --el-bg-color-overlay: #3a332c;
  --el-fill-color: #342e27;
  --el-fill-color-light: #3a332c;
  --el-fill-color-lighter: #3f3830;
  --el-fill-color-blank: #302a23;

  /* 边框 */
  --el-border-color: #4a4036;
  --el-border-color-light: #53483d;
  --el-border-color-lighter: #463c32;
  --el-border-color-dark: #5c5145;

  /* 文字 */
  --el-text-color-primary: #e0d6c8;
  --el-text-color-regular: #c4b8a8;
  --el-text-color-secondary: #9e9080;
  --el-text-color-placeholder: #6e6256;

  /* 主色 — 淡苔色 */
  --el-color-primary: #9aad8e;
  --el-color-primary-light-3: #aebda4;
  --el-color-primary-light-5: #becbb7;
  --el-color-primary-light-7: #cfd9cb;
  --el-color-primary-light-8: #d8e0d5;
  --el-color-primary-light-9: #e1e7de;
  --el-color-primary-dark-2: #8a9c7f;

  /* 成功 */
  --el-color-success: #8eaa8a;
  --el-color-success-light-3: #a4bba1;
  --el-color-success-light-5: #b6c9b4;
  --el-color-success-light-7: #cad8c8;
  --el-color-success-light-8: #d4e0d3;
  --el-color-success-light-9: #dfe7de;

  /* 警告 */
  --el-color-warning: #d4a96a;
  --el-color-warning-light-3: #ddba88;
  --el-color-warning-light-5: #e4c9a2;
  --el-color-warning-light-7: #ecd9bd;
  --el-color-warning-light-8: #f0e1cb;
  --el-color-warning-light-9: #f4e9d8;

  /* 危险 */
  --el-color-danger: #d48a7a;
  --el-color-danger-light-3: #dda195;
  --el-color-danger-light-5: #e4b4aa;
  --el-color-danger-light-7: #ecc9c2;
  --el-color-danger-light-8: #f0d4cf;
  --el-color-danger-light-9: #f4e0dc;

  /* 信息 */
  --el-color-info: #8b9dad;
  --el-color-info-light-3: #a2b1bd;
  --el-color-info-light-5: #b5c1cb;
  --el-color-info-light-7: #cad3da;
  --el-color-info-light-8: #d5dce2;
  --el-color-info-light-9: #e0e5e9;

  /* 通用 */
  --el-color-white: #e0d6c8;
  --el-color-black: #2a241e;
}
```

- [x] **Step 2: 验证文件已创建**

```bash
wc -l src/renderer/src/styles/wabi-sabi.css
```

---

### Task 2: 在 main.ts 中导入侘寂主题 CSS

**Files:**
- Modify: `src/renderer/src/main.ts`

- [x] **Step 1: 读取 main.ts 当前内容**

```
Read src/renderer/src/main.ts
```

- [x] **Step 2: 在 Element Plus 样式导入之后添加 wabi-sabi.css 导入**

在现有的两行 Element Plus CSS 导入之后添加：
```typescript
import './styles/wabi-sabi.css' // Wabi-sabi theme overrides
```

**规则**: 必须在 Element Plus CSS 导入 **之后**，确保 `wabi-sabi.css` 中的 `:root` 和 `html.dark` 变量覆盖生效。

导入后的完整 order:
```typescript
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/wabi-sabi.css'
```

- [x] **Step 3: 类型检查**

```bash
npm run typecheck
```

---

### Task 3: 重写 MainView.vue — 工具栏 + 状态栏

**Files:**
- Modify: `src/renderer/src/views/MainView.vue`

- [x] **Step 1: 读取当前 MainView.vue 完整内容**

- [x] **Step 2: 重构 `<template>` 部分**

将 4 个独立 FAB 按钮替换为顶部工具栏 `<header class="toolbar">`，将 ThemeToggle 移入工具栏。结构如下：

```html
<template>
  <div class="main-view">
    <!-- 顶部工具栏 -->
    <header class="toolbar">
      <div class="toolbar-left">
        <el-button text @click="handleBack" :icon="ArrowLeft">返回</el-button>
        <el-button text @click="handleRescan" :icon="Refresh">扫描</el-button>
        <el-button text @click="handleClearAll" :icon="Delete">清空</el-button>
      </div>
      <div class="toolbar-right">
        <el-button text @click="showSettings = true" :icon="Setting">设置</el-button>
        <ThemeToggle />
      </div>
    </header>

    <!-- 主内容区 -->
    <div class="main-content">
      <SVGTree ... />
      <DrawerPanel ... />
    </div>

    <!-- 状态栏 -->
    <footer class="status-bar">
      <span class="status-dot" :class="statusClass"></span>
      <span class="status-text">{{ statusText }}</span>
      <span class="status-path">{{ projectStore.projectPath }}</span>
    </footer>
  </div>
</template>
```

- [x] **Step 3: 重写 `<style scoped>` 块**

```css
<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--el-bg-color-page);
}

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 12px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── 主内容区 ── */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.tree-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  padding: 16px;
}

/* ── 状态栏 ── */
.status-bar {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color);
  font-size: 12px;
  color: var(--el-text-color-secondary);
  gap: 8px;
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.idle { background: var(--el-text-color-placeholder); }
.status-dot.pending { background: var(--el-color-warning); }
.status-dot.streaming { background: var(--el-color-primary); }
.status-dot.error { background: var(--el-color-danger); }
.status-dot.interrupted { background: var(--el-color-warning); }

.status-text {
  flex-shrink: 0;
}

.status-path {
  margin-left: auto;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

- [x] **Step 4: 类型检查**

```bash
npm run typecheck
```

---

### Task 4: 重写 SVGTree.vue — 节点/边线/Agent 状态点

**Files:**
- Modify: `src/renderer/src/components/SVGTree.vue`

**关键改动**: 
- 节点矩形：用 `--el-fill-color` + `--el-color-primary` 描边替代原 `--el-*` 东京夜蓝/紫色
- 节点选中态：苔色加深
- 边线：线宽 1px
- Agent 状态圆点：去 `drop-shadow` 滤镜，纯色圆点 6px

- [x] **Step 1: 读取 SVGTree.vue 完整 `<style scoped>` 块**

- [x] **Step 2: 重写 `<style scoped>` 块**

核心样式：

```css
<style scoped>
.svg-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.svg-container svg {
  width: 100%;
  height: 100%;
}

/* ── 节点矩形 ── */
.node-rect {
  fill: var(--el-fill-color);
  stroke: var(--el-border-color-dark);
  stroke-width: 1.5;
  rx: 8;
  transition: all 0.15s;
}

.node-rect:hover {
  stroke: var(--el-color-primary);
  stroke-width: 1.5;
}

.node-rect.active {
  fill: var(--el-color-primary-light-8);
  stroke: var(--el-color-primary);
  stroke-width: 2;
}

/* ── 节点文本 ── */
.node-text {
  font-size: 12px;
  font-weight: 600;
  fill: var(--el-text-color-primary);
}

.node-subtext {
  font-size: 10px;
  fill: var(--el-text-color-secondary);
}

/* ── 边线 ── */
.edge-line {
  fill: none;
  stroke: var(--el-border-color);
  stroke-width: 1;
}

/* ── Agent 状态圆点 ── */
.agent-dot {
  r: 6;
  stroke-width: 1;
}

.agent-dot.idle {
  fill: var(--el-fill-color);
  stroke: var(--el-text-color-placeholder);
}

.agent-dot.streaming {
  fill: var(--el-color-primary-light-8);
  stroke: var(--el-color-primary);
}

.agent-dot.error {
  fill: var(--el-color-danger-light-8);
  stroke: var(--el-color-danger);
}

/* ── 收起/展开按钮 ── */
.collapse-btn {
  font-size: 10px;
  fill: var(--el-text-color-secondary);
  cursor: pointer;
}

.collapse-btn:hover {
  fill: var(--el-color-primary);
}
</style>
```

- [x] **Step 3: 检查 SVG 模板中的 class 绑定**

确认 `node-rect`、`agent-dot`、`edge-line` 等 class 名在 `<template>` 的 SVG 元素上正确应用。

---

### Task 5: 重写 DrawerPanel.vue

**Files:**
- Modify: `src/renderer/src/components/DrawerPanel.vue`

**关键改动:**
- 去除 `box-shadow`，改用 1px 左边框分隔
- 背景改用 `--el-fill-color`
- 统一内边距 16px (水平) / 12px (垂直)
- 拖拽把手 2px 宽
- 模块信息间距增至 6px

- [x] **Step 1: 读取 DrawerPanel.vue 完整 `<style scoped>` 块**

- [x] **Step 2: 替换所有自定义 `var(--surface)`/`var(--border)`/`var(--accent)` 等**

映射规则：
| 原变量 | 替换为 |
|--------|--------|
| `var(--bg)` | `var(--el-bg-color-page)` |
| `var(--surface)` | `var(--el-fill-color)` |
| `var(--border)` | `var(--el-border-color)` |
| `var(--text)` | `var(--el-text-color-primary)` |
| `var(--text-dim)` | `var(--el-text-color-secondary)` |
| `var(--accent)` | `var(--el-color-primary)` |
| `var(--accent2)` | `var(--el-color-primary-light-5)` |

- [x] **Step 3: 去掉抽屉阴影，改左边框**

```css
.drawer-panel {
  /* 删除: box-shadow: -4px 0 24px rgba(0,0,0,0.5); */
  border-left: 1px solid var(--el-border-color);
}
```

- [x] **Step 4: 统一内边距**

```css
.drawer-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
}

.drawer-body {
  padding: 12px 16px;
}
```

- [x] **Step 5: 拖拽把手 2px**

```css
.drawer-resize-handle {
  width: 2px;
  background: var(--el-border-color);
}
.drawer-resize-handle:hover {
  background: var(--el-color-primary);
}
```

- [x] **Step 6: 分割线样式**

```css
.splitter {
  height: 2px;
  background: var(--el-border-color);
  margin: 8px 0;
}
.splitter:hover {
  background: var(--el-color-primary);
}
```

---

### Task 6: 重写 StreamArea.vue

**Files:**
- Modify: `src/renderer/src/components/StreamArea.vue`

**关键改动:**
- thinking/tools/reply 三段统一为 2px `--el-border-color` 左边框 + `--el-color-primary-light-8` 微背景
- 去除原彩色左边框 (紫色 #bb9af7 等)
- 光标闪烁 1s
- 整体背景 `--el-fill-color-lighter`

- [x] **Step 1: 读取 StreamArea.vue 完整 `<style scoped>` 块**

- [x] **Step 2: 三段统一样式**

```css
.stream-section {
  margin-bottom: 12px;
  border-left: 2px solid var(--el-border-color);
  padding: 8px 12px;
  background: var(--el-color-primary-light-9); /* 亮色微背景 */
}

.stream-section.think {
  /* 无特殊颜色 */
}

.stream-section.tools {
  /* 同上 */
}

.stream-section.reply {
  /* 同上 */
}
```

- [x] **Step 3: 光标闪烁 1s**

```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.stream-cursor {
  animation: blink 1s infinite;
}
```

- [x] **Step 4: 整体背景**

```css
.stream-container {
  background: var(--el-fill-color-lighter);
  padding: 12px 16px;
}
```

---

### Task 7: 重写 ContextCards.vue — 卡片/徽章/分页

**Files:**
- Modify: `src/renderer/src/components/ContextCards.vue`

**关键改动:**
- 卡片间用 1px 分割线代替独立背景
- 悬停微背景加深，无阴影
- 状态徽章统一 `--el-color-*` 变量
- 7 种徽章颜色从硬编码 hex → CSS 变量

- [x] **Step 1: 读取 ContextCards.vue 完整 `<style scoped>` 块**

- [x] **Step 2: 状态徽章 CSS 变量化**

**目标**: 消除硬编码 rgba，统一用 `--el-color-*` 变体。

```css
.badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
}

/* 统一徽章色系 */
.badge.sent       { background: var(--el-color-info-light-8); color: var(--el-color-info); }
.badge.pending    { background: var(--el-color-warning-light-7); color: var(--el-color-warning); }
.badge.thinking   { background: var(--el-color-primary-light-7); color: var(--el-color-primary); }
.badge.executing  { background: var(--el-color-success-light-7); color: var(--el-color-success); }
.badge.completed  { background: var(--el-color-success-light-8); color: var(--el-color-success); }
.badge.error      { background: var(--el-color-danger-light-7); color: var(--el-color-danger); }
.badge.interrupted{ background: var(--el-color-warning-light-8); color: var(--el-color-warning); }
```

- [x] **Step 3: 卡片改为分割线样式**

```css
.ctx-card {
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: background 0.15s;
}

.ctx-card:last-child {
  border-bottom: none;
}

.ctx-card:hover {
  background: var(--el-fill-color-light);
}
```

- [x] **Step 4: 角色标签样式**

```css
.role-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
```

- [x] **Step 5: 分页按钮**

```css
.pagination-btn {
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  margin: 0 2px;
  cursor: pointer;
  transition: all 0.15s;
}

.pagination-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.pagination-btn.active {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: var(--el-fill-color-blank);
}
```

---

### Task 8: 重写 ChatInput.vue

**Files:**
- Modify: `src/renderer/src/components/ChatInput.vue`

**关键改动:**
- 输入框 focus 去外发光 → 苔色边框
- 发送按钮改 `text` 类型

- [x] **Step 1: 读取 ChatInput.vue 当前完整内容**

- [x] **Step 2: 重写样式**

```css
<style scoped>
.chat-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--el-bg-color);
}

.chat-input-wrap :deep(.el-input__wrapper) {
  border-radius: 8px;
  box-shadow: none !important;
  transition: border-color 0.15s;
}

.chat-input-wrap :deep(.el-input__wrapper:hover) {
  border-color: var(--el-border-color-dark);
}

.chat-input-wrap :deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}
</style>
```

---

### Task 9: 重写 SetupView.vue

**Files:**
- Modify: `src/renderer/src/views/SetupView.vue`

**关键改动:**
- 卡片阴影 `0 1px 3px`
- 圆角 10px
- 输入框 focus 去外发光
- 标签到输入框间距增加

- [x] **Step 1: 读取 SetupView.vue 当前 `<style scoped>` 块**

- [x] **Step 2: 替换自定义 `--el-*` 变量引用**

将现有的 `--el-bg-color-page`、`--el-color-primary` 等引用保持不变（它们已被 `wabi-sabi.css` 覆盖），只需调整阴影和圆角。

```css
.setup-card {
  border-radius: 10px;
  box-shadow: var(--el-box-shadow-light);
}

.setup-card :deep(.el-input__wrapper) {
  box-shadow: none !important;
}

.setup-card :deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}

.setup-card :deep(.el-form-item__label) {
  margin-bottom: 8px;
}
```

---

### Task 10: 重写 SettingsDialog.vue

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.vue`

**关键改动:** 同 SetupView (表单样式) + 对话框头去装饰

- [x] **Step 1: 读取 SettingsDialog.vue 当前 `<style scoped>` 块**

- [x] **Step 2: 重写对话框和表单样式**

```css
/* 对话框标题栏底部 1px 分隔 */
.dialog-footer-separator :deep(.el-dialog__header) {
  border-bottom: 1px solid var(--el-border-color);
  padding-bottom: 12px;
}

/* 输入框 focus */
:deep(.el-input__wrapper) {
  box-shadow: none !important;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: var(--el-color-primary);
  box-shadow: none !important;
}

/* 标签间距 */
:deep(.el-form-item__label) {
  margin-bottom: 6px;
}

/* 卡片/表单容器 */
.settings-form {
  border-radius: 10px;
}
```

---

### Task 11: 重写 ThemeToggle.vue

**Files:**
- Modify: `src/renderer/src/components/ThemeToggle.vue`

**关键改动:** 按钮改为 `text` 类型（无边框无底色）。

- [x] **Step 1: 读取 ThemeToggle.vue 当前完整内容**

- [x] **Step 2: 修改 `<template>`**

```html
<template>
  <el-tooltip :content="isDark ? '切换到亮色模式' : '切换到暗色模式'" placement="bottom">
    <el-button text @click="toggleTheme">
      <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
    </el-button>
  </el-tooltip>
</template>
```

- [x] **Step 3: `<style scoped>` 无需额外样式**（Element Plus text 按钮已足够）

---

### Task 12: 重写 MessageModal.vue

**Files:**
- Modify: `src/renderer/src/components/MessageModal.vue`

**关键改动:**
- 弹窗阴影 `0 1px 4px`
- 圆角统一 10px
- 去弹窗动画
- 状态徽章统一 `--el-color-*`（同 ContextCards 规则）

- [x] **Step 1: 读取 MessageModal.vue 当前 `<style scoped>` 块**

- [x] **Step 2: 弹窗样式**

```css
:deep(.el-dialog) {
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--el-border-color);
  padding: 16px 20px 12px;
}

/* 去掉弹窗弹出动画 */
:deep(.el-dialog) {
  animation: none !important;
}

/* 各段用分割线而非独立背景 */
.modal-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.modal-section:last-child {
  border-bottom: none;
}
```

- [x] **Step 3: 状态徽章 — 同 ContextCards 规则**

将 MessageModal 中的硬编码 7 色徽章替换为与 Task 7 ContextCards 相同的 `--el-color-*` 变量规则。

---

### Task 13: 更新 useTheme.ts（可选 — 确认主题类兼容性）

**Files:**
- Modify: `src/renderer/src/composables/useTheme.ts`

- [x] **Step 1: 读取 useTheme.ts 当前内容，确认 `html.dark` class 切换机制是否正常工作**

- [x] **Step 2: 如需要，确保页面首次加载时应用暗色默认值**

```typescript
// 确保默认暗色主题时 html 有 dark class
if (savedTheme !== 'light') {
  document.documentElement.classList.add('dark')
}
```

---

## Final Verification Wave

- [x] **F1: 类型检查** — `npm run typecheck` 零错误
- [x] **F2: 生产构建** — `npm run build:electron` 零错误
- [x] **F3: 测试通过** — `npm run test` 全部通过
- [x] **F4: 视觉检查** — 手动验证亮/暗主题切换，确认 10 个组件侘寂风格一致

---

## 变量替换速查表

所有组件中替换以下自定义变量引用：

| 原自定义变量 | 替换为 `--el-*` 变量 | 用途 |
|-------------|---------------------|------|
| `var(--bg)` | `var(--el-bg-color-page)` | 页面背景 |
| `var(--surface)` | `var(--el-fill-color)` | 面板/卡片 |
| `var(--border)` | `var(--el-border-color)` | 边框/分割线 |
| `var(--text)` | `var(--el-text-color-primary)` | 主文字 |
| `var(--text-dim)` | `var(--el-text-color-secondary)` | 次要文字 |
| `var(--accent)` | `var(--el-color-primary)` | 强调色 |
| `var(--accent2)` | `var(--el-color-primary-light-5)` | 次要强调 |
| `var(--success)` | `var(--el-color-success)` | 成功色 |
| `var(--warning)` | `var(--el-color-warning)` | 警告色 |
| `var(--error)` | `var(--el-color-danger)` | 错误色 |
