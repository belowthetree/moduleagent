# PathUtils & ExclusionRules — 路径工具与排除规则

> 文件：`src/core/PathUtils.ts`, `src/core/ExclusionRules.ts`

---

## PathUtils — 跨平台路径处理

### normalizeCodeSourcePath(p: string): string

处理跨平台路径差异，特别是 WSL/Linux 下 Windows 绝对路径的转换。

```typescript
// Windows 上：直接 resolve
normalizeCodeSourcePath('E:\\foo\\bar')  // → 'E:\\foo\\bar'

// Linux/WSL 上：转换为 /mnt/<drive>/ 格式
normalizeCodeSourcePath('E:\\foo\\bar')  // → '/mnt/e/foo/bar'
```

**使用场景**：当开发者在 WSL 中运行 ModuleAgent 但项目位于 Windows 文件系统时，Agent 子进程需要访问跨文件系统的路径。Node.js 的 `path.resolve()` 在处理 Windows 盘符路径时失效（不识别为绝对路径），此函数进行适配。

---

## ExclusionRules — 内置排除规则

### BUILTIN_EXCLUDED_DIRS

默认排除的目录：

```typescript
const BUILTIN_EXCLUDED_DIRS = [
  'node_modules',   // Node.js 依赖
  '.git',            // Git 仓库
  'dist',            // 构建输出
  'build',           // 构建输出
  '__pycache__',     // Python 缓存
  '.next',           // Next.js 构建
  'coverage',        // 测试覆盖率
  '.turbo',          // Turborepo 缓存
];
```

### BUILTIN_EXCLUDED_FILES

默认排除的文件：

```typescript
const BUILTIN_EXCLUDED_FILES = [
  '.DS_Store',       // macOS 系统文件
  'Thumbs.db',       // Windows 缩略图
  '.env',            // 环境变量文件
  '.env.local',      // 本地环境变量
];
```

### isBuiltinExcluded(name: string): boolean

判断文件名/目录名是否在内置排除列表中。

**使用场景**：
- `ModuleScanner` 在递归扫描时跳过这些目录
- `ModuleGenerator` 在推断子模块时排除
- `WorkspaceIsolator` 在复制源码时过滤（`node_modules`、`.git`）
- 用户可通过 `.module-agent.json` 的 `exclude` 字段追加自定义排除规则
