# 模块系统 — Scanner / Parser / Graph / Generator

> 文件：`src/core/ModuleScanner.ts`, `ModuleParser.ts`, `ModuleGraph.ts`, `ModuleGenerator.ts`

## 概述

模块系统负责模块的发现、解析、关系构建和自动生成，构成 ModuleAgent 的数据基础。

---

## ModuleScanner — 模块扫描器

**类**：`ModuleScanner`（纯静态方法）

### 职责

递归扫描 `.module-agent/module/` 目录，发现所有 `module.md` 文件。

### 扫描流程

```
ModuleScanner.scan({ projectRoot, extraExclude })
  │
  ├─ scanDir() 递归遍历目录
  │   ├─ 跳过排除目录（ExclusionRules + extraExclude）
  │   ├─ 发现 module.md → 记录为模块根目录
  │   └─ 子目录继续递归
  │
  ├─ 返回 ModuleDescriptor[]
  │   { rootPath, relativePath, definition, name }
  │
  └─ ensureDocFiles()
      → 为每个模块初始化 experience.md 和 patterns.md
```

### 输出

```typescript
interface ModuleDescriptor {
  rootPath: string;        // 模块物理目录的绝对路径
  relativePath: string;    // 相对于扫描根目录的路径
  name: string;            // 模块名称
  definition: ModuleDefinition;  // 解析后的模块定义
}
```

---

## ModuleParser — 模块解析器

**类**：`ModuleParser`（纯静态方法）

### 职责

解析单个 `module.md` 文件，提取 frontmatter 和 Markdown 正文。

### 解析流程

```
ModuleParser.parseFile(filePath)
  │
  ├─ gray-matter(raw) → { data, content }
  │
  ├─ parseFrontmatter(data)
  │   → { name, description, submodules }
  │   ├─ 优先使用 frontmatter 中的 submodules 字段
  │   └─ 回退到 Markdown 正文中的 "子模块" 列表
  │
  ├─ marked.lexer(content) → 解析 Markdown tokens
  │
  ├─ parseDescription(tokens)
  │   → 从 "## 模块说明" 段落提取描述
  │
  └─ 返回 ModuleDefinition
      { frontmatter, body, description, subModules }
```

### module.md 格式

```markdown
---
name: core
description: 核心模块
submodules:
  - name: utils
    path: ./utils
    description: 工具模块
---

# core

## 模块说明
提供核心功能...

## 子模块
- `utils/` - 工具函数
```

---

## ModuleGraph — 模块图

**类**：`ModuleGraph`

### 职责

将扫描得到的模块列表构建为树形图（邻接表），建立模块间的父子关系。

### 数据结构

```typescript
interface ModuleGraph {
  root: string;                         // 根节点名称
  nodes: Map<string, ModuleGraphNode>;  // 邻接表
}

interface ModuleGraphNode {
  name: string;
  absolutePath: string;
  relativePath: string;
  parent: string | null;
  children: string[];
  definition: ModuleDefinition;
}
```

### 构建流程

```
ModuleGraph.build(descriptors, projectRoot)
  │
  ├─ 遍历 descriptors，按 relativePath 归一化模块名
  ├─ 处理同名冲突：按 relativePath 重命名
  ├─ 确定根节点（relativePath === '.'）
  ├─ 建立父子关系：
  │   └─ 对每个模块的 subModules，查找对应子模块并关联
  │
  └─ 返回 ModuleGraph { root, nodes }
```

### 访问控制

`getSubtreeNames(graph, startName)` 递归收集子树中所有节点名，用于确定模块的可见范围。

---

## ModuleGenerator — 模块自动生成器

**类**：`ModuleGenerator`（纯静态方法）

### 职责

自动扫描目录并生成 `module.md` 文件。

### 生成流程

```
ModuleGenerator.generate({ dirPath, projectRoot, force, extraExclude })
  │
  ├─ inferDescription(dirPath)
  │   → 检测 package.json / Cargo.toml 推断项目类型
  │   → 生成模块描述
  │
  ├─ inferSubModules(dirPath, projectRoot, extraExclude)
  │   → 扫描子目录（排除排除项）
  │   → 推断子模块名称和路径
  │
  ├─ inferBody(dirPath, moduleName)
  │   → 扫描文件结构生成模块说明
  │
  └─ composeModuleMd(frontmatter, body, subModules)
      → 组装完整的 module.md 内容
```

---

## 依赖关系

```
ModuleScanner ──► ModuleParser ──► ModuleGraph
                                      │
ModuleGenerator ──────────────────────┘
（生成 module.md 文件，供 Scanner 重新扫描）
```
