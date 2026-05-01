# CLI 交互协议

ModuleAgent CLI 支持两种交互模式：**one-shot 命令**和**持久化 stdio 服务**。

---

## 1. One-shot 命令

命令行参数入，JSON 出（stdout），错误出（stderr），然后退出。

### 命令格式

```
module-agent <command> [options]
```

### 命令列表

| 命令 | 格式 | 说明 |
|------|------|------|
| `list` | `module-agent list [--project <path>]` | 列出项目所有模块 |
| `get` | `module-agent get <name> [--project <path>]` | 获取单个模块详情 |
| `serve` | `module-agent serve [--project <path>]` | 进入 stdio 服务模式 |

### 通用选项

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定项目根目录，省略时从 cwd 向上查找 |
| `--help, -h` | 帮助信息 |
| `--version, -v` | 版本号 |

### 输出格式

所有输出为单行 JSON：

```json
{"success": true, "data": {...}}
```

错误输出到 stderr：

```json
{"success": false, "error": "<message>"}
```

### 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 运行时错误 |
| 2 | 参数错误 |

---

## 2. NDJSON 持久化服务协议

`serve` 命令启动后，进程保持运行，通过 stdin/stdout 以 **NDJSON**（Newline-Delimited JSON）格式通信。stderr 仅用于日志输出。

### 2.1 请求格式

stdin 每行一个 JSON 对象：

```json
{"id": "<string>", "type": "<command>", "name": "<optional>"}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 请求标识，响应中原样返回 |
| `type` | string | 是 | 命令类型：`list`、`get`、`rescan`、`exit` |
| `name` | string | 否 | 模块名称（`get` 时必填） |

### 2.2 响应格式

stdout 每行一个 JSON 对象：

```json
{"id": "<string>", "success": <bool>, "data": {...}}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 对应的请求 id |
| `success` | bool | 是否成功 |
| `data` | object | 成功时的数据（失败时省略） |
| `error` | string | 失败时的错误消息（成功时省略） |

### 2.3 命令类型

#### list — 列出模块

请求：
```json
{"id": "1", "type": "list"}
```

响应 data 结构：
```jsonc
{
  "id": "1",
  "success": true,
  "data": {
    "root": "my-app",
    "modules": [
      {
        "name": "server",
        "path": "server",
        "description": "后端服务模块",
        "children": ["api", "models"],
        "parent": "my-app"
      }
    ]
  }
}
```

#### get — 获取模块详情

请求：
```json
{"id": "2", "type": "get", "name": "server"}
```

响应 data 结构：
```jsonc
{
  "id": "2",
  "success": true,
  "data": {
    "name": "server",
    "path": "server",
    "absolutePath": "/abs/path/to/server",
    "description": "后端服务模块",
    "parent": "my-app",
    "children": ["api", "models"],
    "frontmatter": {
      "name": "server",
      "description": "后端服务模块",
      "submodules": [
        {"name": "api", "path": "api", "description": "API 层"}
      ]
    },
    "body": "# 后端服务\n\n## 模块说明\n\n..."
  }
}
```

未找到时的错误响应：
```json
{"id": "2", "success": false, "error": "Module not found: nonexistent"}
```

#### rescan — 重新扫描

请求：
```json
{"id": "3", "type": "rescan"}
```

响应：与 `list` 相同的 data 结构，返回刷新后的模块列表。

#### exit — 退出

请求：
```json
{"id": "4", "type": "exit"}
```

响应：
```json
{"id": "4", "success": true, "data": null}
```

进程退出码 0。

### 2.4 错误处理

- 无法解析的 JSON 行：stderr 日志，跳过该行（不产生响应）
- 缺少 `id` 或 `type`：stderr 日志，跳过
- 未知 `type`：stderr 日志 `Unknown type: xxx`
- 命令执行异常：返回 `{"id": "...", "success": false, "error": "..."}`

---

## 3. 项目根目录发现策略

1. 使用了 `--project <path>` → 验证路径存在
2. 从 `cwd` 向上查找 `.module-agent.json` 或 `module.md`
3. 都找不到 → 报错退出

---

## 4. 示例

### One-shot

```bash
# 列出模块
node dist/cli.cjs list --project /path/to/project

# 获取模块详情
node dist/cli.cjs get server --project /path/to/project
```

### Serve 模式（管道）

```bash
printf '{"id":"1","type":"list"}
{"id":"2","type":"get","name":"server"}
{"id":"3","type":"exit"}
' | node dist/cli.cjs serve --project /path/to/project
```

### Serve 模式（交互式）

```bash
node dist/cli.cjs serve --project /path/to/project
# 输入: {"id":"1","type":"list"}
# 输出: {"id":"1","success":true,"data":{...}}
# 输入: {"id":"2","type":"exit"}
```
