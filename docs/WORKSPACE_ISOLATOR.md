# WorkspaceIsolator — 工作空间隔离

> 文件：`src/agents/WorkspaceIsolator.ts`

## 概述

`WorkspaceIsolator` 提供模块工作空间的路径计算和隔离拷贝功能。每个模块 Agent 在独立的工作空间中运行，拥有其自身源码的独立副本，避免 Agent 之间的文件冲突。

## 核心函数

### workspacePathForModule(node, workspaceRoot, projectRoot)

计算模块的隔离工作空间路径：

```typescript
workspacePathForModule(node, workspaceRoot, projectRoot): string
```

规则：
- 有 `workspaceRoot` 时：`<workspaceRoot>/<relativePath>`（根模块为 `<workspaceRoot>/<name>`）
- 无 `workspaceRoot` 时：返回 `node.absolutePath`（不隔离）

### codeSourcePathForModule(node, projectPath)

计算模块的源码路径：

```typescript
codeSourcePathForModule(node, projectPath): string
```

规则：
- 根模块（relativePath === '.'）：返回 `projectPath`
- 子模块：返回 `projectPath/relativePath`

---

## prepareModuleWorkspace(node, options)

**核心函数**：准备模块的隔离工作空间。

```typescript
prepareModuleWorkspace(
  node: ModuleGraphNode,
  options: {
    workspaceRoot: string | null;
    projectPath: string;
    graph: ModuleGraphType | null;
  }
): Promise<string>
```

### 执行流程

```
1. 无 workspaceRoot → 直接返回 node.absolutePath（不隔离）

2. 计算 destDir（隔离目标路径）和 srcDir（源码路径）

3. 检查 srcDir 是否存在：
   ├─ 不存在 → ensureDir(destDir) + 返回 destDir
   └─ 存在 → 继续

4. srcDir === destDir → 直接返回（无需拷贝）

5. 计算子模块排除路径：
   └─ 遍历 node.children，找到每个子模块的 relativePath
       计算相对于父模块源码目录的子路径

6. fse.copy(srcDir, destDir, { filter }):
   ├─ 排除 node_modules、.git
   └─ 排除子模块目录（避免父模块 workspace 中包含子模块源码）

7. 拷贝失败 → 回退到 node.absolutePath（永不抛异常）
```

### 子模块排除逻辑

父模块 workspace 中排除子模块目录，确保每个模块 Agent 只能看到自己的代码：

```
项目结构：
  src/
  ├── core/        → 父模块
  └── utils/       → 子模块

父模块 workspace：
  workspace/src/core/
  └── (不包含 utils/ 目录)
```

---

## getSubModuleDirs(node, graph, workspacePathFn)

获取子模块的工作空间目录列表：

```typescript
getSubModuleDirs(
  node: ModuleGraphNode,
  graph: ModuleGraphType | null,
  workspacePathFn: (n: ModuleGraphNode) => string
): string[]
```

**用途**：传递给 `FsHandler` 的 `subModuleDirs` 参数，允许 Agent 的文件系统处理器在子模块工作空间中读写文件，实现跨模块文件访问。

---

## 隔离策略对比

| 场景 | workspaceRoot | 行为 |
|------|--------------|------|
| 无隔离 | `null` | Agent 直接在项目源目录运行，共享文件系统 |
| 完全隔离 | `".module-agent/workspace"` | 每个模块复制源码到独立目录 |
| 错误容错 | — | 拷贝失败时回退到源目录，Agent 仍可运行 |

## 安全性

- **文件系统隔离**：`FsHandler` 限制文件操作在 `cwd + subModuleDirs` 范围内
- **目录穿越防护**：所有路径经过 `path.resolve` 后检查前缀
- **排除敏感文件**：`.env`, `.env.local` 等不会出现在 workspace 中
