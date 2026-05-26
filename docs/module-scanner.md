# 模块扫描系统

> 递归扫描项目目录，解析 `module.md` 文件，构建模块依赖树。

## 文件

| 文件 | 职责 |
|------|------|
| `module/scanner.rs` | 递归目录遍历，找到并解析 `module.md` |
| `module/parser.rs` | 解析 `module.md` 的 YAML frontmatter 和 Markdown 正文 |
| `module/graph.rs` | 从扫描描述符构建模块图谱（名称→节点映射） |
| `module/types.rs` | 核心类型：描述符、定义、图谱节点 |

## 模块描述符（ModuleDescriptor）

```rust
pub struct ModuleDescriptor {
    pub name: String,              // frontmatter 中的 name
    pub root_path: PathBuf,        // module.md 所在目录的绝对路径
    pub relative_path: String,     // 从项目根目录的相对路径
    pub module_md_path: PathBuf,   // module.md 文件的完整路径
    pub definition: ModuleDefinition,  // 解析后的内容
}
```

## 扫描流程

```
scanner::scan(options)
  → 检查 project_root 存在
  → spawn_blocking → scan_dir_sync()
    → 遍历目录条目
    → 目录：检查排除规则 → 递归扫描
      • .module-agent 特殊处理：只进入 module/ 子目录
    → 文件：如果名为 module.md → 解析
  → 返回 Vec<ModuleDescriptor>
```

## 排除规则

```rust
const BUILTIN: &[&str] = &[
    "node_modules", ".git", "dist", "target",
    "__pycache__", ".venv", "venv", ".next", ".nuxt", ".cache",
];
// 所有以 . 开头的目录也排除（除 .module-agent/module/ 外）
```

`.module-agent` 目录特殊处理：
- 只进入 `.module-agent/module/` 子目录进行扫描
- 跳过 `context/`、`workspace/` 等其他子目录

## 模块解析（ModuleParser）

解析 `module.md` 文件：

```
文件内容：
---
name: 核心引擎
description: 项目核心业务逻辑
---
# 核心引擎

模块正文内容...
```

提取：
- **Frontmatter**：YAML 格式，包含 `name`（必需）、`description`（可选）、`subModules`（可选）
- **正文**：YAML 分隔符 `---` 之后的 Markdown 内容

## 模块图谱（ModuleGraph）

从 `Vec<ModuleDescriptor>` 构建内存中的模块树。

### 根节点检测

1. 查找 `relative_path == "."` 的模块（位于项目根目录）→ 设为根节点
2. 如无根模块，取路径最浅的模块作为根节点

### 父子关系

构建时自动计算父子关系：
- 子模块的 `relative_path` 去掉最后一段 `/...` 后匹配父模块的 `relative_path`
- 这些关系存储在每个 `ModuleGraphNode` 的 `children` 和 `parent` 字段中

### 模块树构建（project_tree 命令）

当模块不在项目根目录（如在 `.module-agent/module/` 下）时：

1. 虚拟根节点命名为项目目录名
2. 收集所有"顶层模块"：父路径上没有对应模块的节点
3. 对每个顶层模块，递归查找其子模块

## 关键日志

```
[INFO] 开始扫描项目模块: /path/to/project
[INFO] 模块扫描完成，发现 5 个模块
[WARN] 解析 module.md 失败: /path (error message)
```
