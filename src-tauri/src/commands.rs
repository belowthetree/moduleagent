use std::sync::Arc;
use tauri::State;
use serde_json::{json, Value};
use log;

use crate::state::AppState;
use crate::util::{AppError, AppResult};
use crate::config::defaults;
use crate::config::loader::ConfigLoader;
use crate::config::schema::{AgentConfig, RoleConfig};
use crate::module::scanner;
use crate::module::graph::ModuleGraph;
use crate::workflow::executor::{WorkflowExecutor, WorkflowStep};
use crate::workflow::scanner::WorkflowScanner;

#[tauri::command]
pub async fn project_scan(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let project_path = body["projectPath"].as_str().unwrap_or(".");
    log::info!("接收项目扫描请求: {}", project_path);
    *state.project_root.write().await = Some(project_path.to_string());

    let options = scanner::ScanOptions {
        project_root: project_path.to_string(),
        extra_exclude: Vec::new(),
    };

    match scanner::scan(&options).await {
        Ok(descriptors) => {
            let mut graph = ModuleGraph::default();
            let p = std::path::Path::new(project_path);
            let _ = graph.build(descriptors, p);
            *state.initialized.write().await = true;

            let nodes_json: serde_json::Map<String, Value> = graph
                .nodes().iter()
                .map(|(name, node)| (name.clone(), json!({
                    "name": node.name,
                    "absolutePath": node.absolute_path,
                    "relativePath": node.relative_path,
                    "parent": node.parent,
                    "children": node.children,
                })))
                .collect();

            let root = graph.root().map(|s| Value::String(s.to_string()));
            let result = json!({ "root": root, "nodes": nodes_json, "moduleCount": graph.len() });
            *state.module_graph.write().await = Some(graph);
            Ok(result)
        }
        Err(e) => {
            log::error!("项目扫描失败: {}", e);
            *state.module_graph.write().await = None;
            *state.initialized.write().await = true;
            Ok(json!({ "root": null, "nodes": {}, "moduleCount": 0 }))
        }
    }
}

#[tauri::command]
pub async fn project_tree(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let graph_guard = state.module_graph.read().await;
    let graph = match graph_guard.as_ref() {
        Some(g) => g,
        None => return Ok(Value::Null),
    };

    if graph.is_empty() {
        return Ok(Value::Null);
    }

    let root_name = match graph.root() {
        Some(name) => name.to_string(),
        None => return Ok(Value::Null),
    };

    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".to_string());
    let tree = build_tree_node(&graph, &root_name, &project_root);
    Ok(serde_json::to_value(tree).unwrap_or(Value::Null))
}

fn build_tree_node(
    graph: &ModuleGraph,
    name: &str,
    project_root: &str,
) -> serde_json::Value {
    let node = graph.get(name);
    let path = node.map(|n| n.relative_path.clone()).unwrap_or_else(|| ".".into());
    let description = node.and_then(|n| n.definition.frontmatter.description.clone());

    // Build children: find all nodes whose relative_path starts with this node's path
    let mut children: Vec<serde_json::Value> = Vec::new();
    for (child_name, child_node) in graph.nodes() {
        if child_name == name {
            continue;
        }
        // A child module is one whose directory is directly inside this node's directory
        let child_path = child_node.relative_path.replace('\\', "/");
        let parent_path = if let Some(pos) = child_path.rfind('/') {
            &child_path[..pos]
        } else {
            "."
        };
        if parent_path == path {
            children.push(build_tree_node(graph, child_name, project_root));
        }
    }

    json!({
        "name": name,
        "path": path,
        "description": description,
        "children": children,
        "cwd": project_root,
    })
}

#[tauri::command]
pub async fn project_generate() -> Result<Value, String> {
    Ok(json!({ "count": 0 }))
}

#[tauri::command]
pub async fn agent_start(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let name = body["name"].as_str().ok_or("missing 'name' field")?;
    log::info!("接收启动 Agent 请求: {}", name);
    let cwd_str = body["cwd"].as_str().unwrap_or(".");
    let cwd = std::path::Path::new(cwd_str);
    let command = body["command"].as_str().unwrap_or("npx").to_string();
    let args: Vec<String> = body["args"].as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_else(|| vec!["-y".into(), "@zed-industries/claude-code-acp@latest".into()]);

    let config = AgentConfig { command, args: Some(args), fast_model: None, normal_model: None, auto_switch_model: None };
    state.agent_manager.start_agent(name, &config, cwd).await.map_err(|e| e.to_string())?;
    state.broadcast("agent-status", json!({ "name": name, "status": "idle" }));
    Ok(json!({ "sessionId": name }))
}

#[tauri::command]
pub async fn agent_send(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let name = body["name"].as_str().ok_or("missing 'name' field")?;
    let text = body["text"].as_str().ok_or("missing 'text' field")?;
    log::info!("接收 Agent 消息请求 [{}]: {} 字符", name, text.chars().count());
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".to_string());
    let project_path = std::path::Path::new(&project_root);
    let result = state.agent_manager.send_message(name, text, project_path).await.map_err(|e| e.to_string())?;
    Ok(json!({ "result": { "reply": result.reply, "thinking": result.thinking, "tools": result.tools, "timeline": result.timeline, "stopReason": result.stop_reason.unwrap_or_else(|| "end_turn".to_string()) } }))
}

#[tauri::command]
pub async fn agent_cancel(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let name = body["name"].as_str().ok_or("missing 'name' field")?;
    log::info!("接收取消 Agent 请求: {}", name);
    state.agent_manager.cancel_agent(name).await.map_err(|e| e.to_string())?;
    state.broadcast("agent-status", json!({ "name": name, "status": "idle" }));
    Ok(json!({ "reply": "", "thinking": "", "tools": "" }))
}

#[tauri::command]
pub async fn agent_stop(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let name = body["name"].as_str().ok_or("missing 'name' field")?;
    log::info!("接收停止 Agent 请求: {}", name);
    state.agent_manager.stop_agent(name).await.map_err(|e| e.to_string())?;
    state.broadcast("agent-status", json!({ "name": name, "status": "stopped" }));
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn agent_running(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let agents = state.agent_manager.list_agents().await;
    Ok(serde_json::to_value(agents).unwrap_or(json!([])))
}

#[tauri::command]
pub async fn config_get(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".to_string());
    let loader = ConfigLoader::new(&project_root);
    let config = loader.load().await.map_err(|e| e.to_string())?;
    let entry = config.configs.first();
    Ok(json!({
        "command": entry.map(|e| &e.config.agents.default.command).unwrap_or(&String::new()),
        "args": entry.and_then(|e| e.config.agents.default.args.as_ref()).cloned().unwrap_or_default(),
        "projectPath": entry.map(|e| e.config.project_path.as_str()).unwrap_or(""),
        "summarizationEnabled": entry.and_then(|e| e.config.summarization.as_ref()).map(|s| s.enabled).unwrap_or(true),
    }))
}

#[tauri::command]
pub async fn config_save(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".to_string());
    let loader = ConfigLoader::new(&project_root);
    let mut config = loader.load().await.map_err(|e| e.to_string())?;
    if let Some(entry) = config.configs.first_mut() {
        if let Some(cmd) = body["command"].as_str() { entry.config.agents.default.command = cmd.to_string(); }
        if let Some(args) = body["args"].as_array() { entry.config.agents.default.args = Some(args.iter().filter_map(|v| v.as_str().map(String::from)).collect()); }
        if let Some(pp) = body["projectPath"].as_str() { entry.config.project_path = pp.to_string(); }
    }
    loader.save(&config).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn context_get(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let path = state.config_dir.join("context").join(format!("{name}.json"));
    if path.exists() {
        let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&content).unwrap_or(json!([])))
    } else {
        Ok(json!([]))
    }
}

#[tauri::command]
pub async fn context_clear(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let path = state.config_dir.join("context").join(format!("{name}.json"));
    if path.exists() { let _ = tokio::fs::remove_file(&path).await; }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn context_clear_all(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let base = state.config_dir.join("context");
    if base.exists() {
        let mut entries = tokio::fs::read_dir(&base).await.map_err(|e| e.to_string())?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if entry.file_type().await.map_err(|e| e.to_string())?.is_file() {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn roles_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let config = loader.load().await.map_err(|e| e.to_string())?;
    let mut roles = config.roles.unwrap_or_default();
    if roles.is_empty() {
        let mut role = defaults::default_module_gen_role();
        if let Some(entry) = config.configs.first() {
            role.agents.default.command = entry.config.agents.default.command.clone();
            role.agents.default.args = entry.config.agents.default.args.clone();
        }
        roles.push(role);
    }
    Ok(serde_json::to_value(roles).unwrap_or(json!([])))
}

#[tauri::command]
pub async fn roles_save(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let mut config = loader.load().await.map_err(|e| e.to_string())?;
    let role: RoleConfig = serde_json::from_value(body).map_err(|e| e.to_string())?;
    let roles = config.roles.get_or_insert_with(Vec::new);
    roles.retain(|r| r.name != role.name);
    roles.push(role);
    loader.save(&config).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn roles_delete(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let mut config = loader.load().await.map_err(|e| e.to_string())?;
    if let Some(roles) = config.roles.as_mut() { roles.retain(|r| r.name != name); }
    let _ = state.role_manager.stop(&name).await;
    loader.save(&config).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn role_start(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let config = loader.load().await.map_err(|e| e.to_string())?;
    let roles = config.roles.unwrap_or_default();
    let role = roles.iter().find(|r| r.name == name).ok_or(format!("role '{name}' not found"))?;
    log::info!("接收角色启动请求: {}", name);
    let session_id = state.role_manager.start(role).await.map_err(|e| e.to_string())?;
    Ok(json!({ "sessionId": session_id }))
}

#[tauri::command]
pub async fn role_send(
    state: State<'_, Arc<AppState>>,
    name: String,
    body: Value,
) -> Result<Value, String> {
    let text = body["text"].as_str().unwrap_or("");
    let reply = state.role_manager.send(&name, text).await.map_err(|e| e.to_string())?;
    Ok(json!({ "result": { "reply": reply, "stopReason": "end_turn" } }))
}

#[tauri::command]
pub async fn role_cancel(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    state.role_manager.cancel(&name).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn role_stop(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    state.role_manager.stop(&name).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn role_context_get(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let path = state.config_dir.join("context").join(format!("role-{name}.json"));
    if path.exists() {
        let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&content).unwrap_or(json!([])))
    } else {
        Ok(json!([]))
    }
}

#[tauri::command]
pub async fn role_context_clear(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let path = state.config_dir.join("context").join(format!("role-{name}.json"));
    if path.exists() { let _ = tokio::fs::remove_file(&path).await; }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn knowledge_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let dir = state.config_dir.join("knowledge");
    let mut files = Vec::new();
    if dir.exists() {
        let mut entries = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if entry.file_type().await.map_err(|e| e.to_string())?.is_file() {
                if let Some(name) = entry.file_name().to_str() { files.push(json!({ "filename": name })); }
            }
        }
    }
    Ok(json!(files))
}

#[tauri::command]
pub async fn knowledge_read(
    state: State<'_, Arc<AppState>>,
    filename: String,
) -> Result<Value, String> {
    let path = state.config_dir.join("knowledge").join(&filename);
    if path.exists() {
        let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        Ok(json!({ "filename": filename, "content": content }))
    } else {
        Ok(json!({ "filename": filename, "content": "" }))
    }
}

#[tauri::command]
pub async fn knowledge_save(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let filename = body["filename"].as_str().unwrap_or("untitled.md");
    let content = body["content"].as_str().unwrap_or("");
    let dir = state.config_dir.join("knowledge");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    crate::util::fs::atomic_write(&path, content.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn knowledge_delete(
    state: State<'_, Arc<AppState>>,
    filename: String,
) -> Result<Value, String> {
    let path = state.config_dir.join("knowledge").join(&filename);
    if path.exists() { let _ = tokio::fs::remove_file(&path).await; }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let scanner = WorkflowScanner::new(state.workspace_root.join("workflows"));
    let workflows = scanner.list().await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(workflows).unwrap_or(json!([])))
}

#[tauri::command]
pub async fn workflow_load(
    name: String,
) -> Result<Value, String> {
    Ok(json!({ "name": name, "steps": [] }))
}

#[tauri::command]
pub async fn workflow_create(
    state: State<'_, Arc<AppState>>,
    body: Value,
) -> Result<Value, String> {
    let name = body["name"].as_str().unwrap_or("new-workflow");
    log::info!("创建工作流: {}", name);
    let dir = state.workspace_root.join("workflows").join(name);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_delete(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<Value, String> {
    let dir = state.workspace_root.join("workflows").join(&name);
    if dir.exists() { let _ = tokio::fs::remove_dir_all(&dir).await; }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_step_save(
    state: State<'_, Arc<AppState>>,
    name: String,
    body: Value,
) -> Result<Value, String> {
    let dir = state.workspace_root.join("workflows").join(&name);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    crate::util::fs::atomic_write(&dir.join("STEP.md"), body["content"].as_str().unwrap_or("").as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_step_delete(
    state: State<'_, Arc<AppState>>,
    name: String,
    step: String,
) -> Result<Value, String> {
    let dir = state.workspace_root.join("workflows").join(&name).join(&step);
    if dir.exists() { let _ = tokio::fs::remove_dir_all(&dir).await; }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_step_add(
    state: State<'_, Arc<AppState>>,
    name: String,
    body: Value,
) -> Result<Value, String> {
    let step_name = body["name"].as_str().unwrap_or("new-step");
    let dir = state.workspace_root.join("workflows").join(&name).join(step_name);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let default_step = format!("# {step_name}\n\n");
    crate::util::fs::atomic_write(&dir.join("STEP.md"), default_step.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_execute(
    state: State<'_, Arc<AppState>>,
    name: String,
    body: Value,
) -> Result<Value, String> {
    let user_input = body["input"].as_str().unwrap_or("");
    log::info!("接收工作流执行请求: {}", name);
    let steps = vec![WorkflowStep { name: name.clone(), agent_name: name.clone(), input_from: "user".to_string() }];
    let executor = WorkflowExecutor::new(state.agent_manager.clone());
    *state.workflow_executor.write().await = Some(executor);
    let result = if let Some(ref exec) = *state.workflow_executor.read().await {
        exec.execute(&steps, user_input).await.map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    Ok(json!({ "sessionId": name, "result": result }))
}

#[tauri::command]
pub async fn workflow_cancel(
    state: State<'_, Arc<AppState>>,
    _name: String,
) -> Result<Value, String> {
    if let Some(ref exec) = *state.workflow_executor.read().await { exec.cancel(); }
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn workflow_status(
    state: State<'_, Arc<AppState>>,
    _name: String,
) -> Result<Value, String> {
    let has_executor = state.workflow_executor.read().await.is_some();
    Ok(json!({ "status": if has_executor { "running" } else { "idle" } }))
}

#[tauri::command]
pub async fn migrate_check() -> Result<Value, String> {
    Ok(json!({ "needed": [], "streamNeeded": false }))
}

#[tauri::command]
pub async fn migrate_data() -> Result<Value, String> {
    Ok(json!({}))
}