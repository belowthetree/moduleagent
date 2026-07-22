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
  relativePath: string;    // 相对于扫描根目录的路径（分隔符恒为 '/'，Windows 已归一化）
  name: string;            // 模块名称（见下「模块标识语义」）
  moduleMdPath: string;    // module.md 文件的绝对路径
  definition: ModuleDefinition;  // 解析后的模块定义
}
```

### 模块标识语义

**模块名 = 相对 `.module-agent/module/` 扫描根的路径，分隔符恒为 `/`**（`path.relative` 在 Windows 产出的反斜杠已统一替换，Windows 模块名同样不含 `\`）。唯一例外是**根模块**（`relativePath === '.'`），其名称取 frontmatter 的 `name` 字段。

模块名跨平台稳定，跨模块解析（`ModuleGraph.findModuleByName`）、`module.md` 中的路径引用、`@module` 路由均以 `/` 分隔的相对路径为准。

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
  │
  ├─ marked.lexer(content) → 解析 Markdown tokens
  │
  ├─ 子模块列表：优先 frontmatter 的 submodules 字段，
  │   缺失时回退到正文 "## 子模块" 列表（兼容旧格式）
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
  ├─ 归一化所有 relativePath 分隔符为 '/'
  ├─ 节点名 = relativePath（根模块 relativePath === '.' 时用 frontmatter name）
  ├─ 处理同名冲突：按 relativePath 重命名（无法消歧则跳过并告警）
  ├─ 确定根节点（relativePath === '.'，缺失则抛错）
  ├─ 建立父子关系：
  │   └─ 对每个模块的 subModules，经 findModuleByName 查找子模块并关联
  │      （解析顺序：父路径+声明 path → 父路径+name → 全局 name → 全局 relativePath）
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
  ├─ 模块名 = 相对 projectRoot 的路径（根模块用 projectRoot 的 basename）
  │
  ├─ inferDescription(dirPath)
  │   → 依次尝试 package.json description → Cargo.toml description
  │   → 均缺失时回退为 "<目录名> 模块"
  │
  ├─ inferSubModules(dirPath, projectRoot, extraExclude)
  │   → 扫描子目录（排除内置排除项与 extraExclude）
  │   → 子模块 name = 相对 projectRoot 的路径，path = ./<目录名>
  │
  ├─ inferBody(dirPath, moduleName)
  │   → 生成占位正文（"# <name>\n\n## 模块说明\n\n待补充"）
  │
  └─ composeModuleMd(frontmatter, body, subModules)
      → 组装完整的 module.md 内容（YAML frontmatter + 正文）
```

另有静态辅助 `ModuleGenerator.createModuleMd(name, description?)`，生成无子模块的最简 module.md 内容。

---

## 依赖关系

```
ModuleScanner ──► ModuleParser ──► ModuleGraph
                                      │
ModuleGenerator ──────────────────────┘
（生成 module.md 文件，供 Scanner 重新扫描）
```
