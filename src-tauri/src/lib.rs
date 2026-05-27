pub mod agent;
pub mod commands;
pub mod config;
pub mod mcp;
pub mod module;
pub mod role;
pub mod state;
pub mod util;
pub mod workflow;

use std::sync::Arc;
use tauri::Manager;
use crate::state::AppState;

#[tauri::command]
async fn select_dir(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = window.dialog().file().blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::util::log::init_logging();
    log::info!("ModuleAgent 应用启动");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = AppState::new(handle)
                .expect("Failed to create AppState");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_dir,
            commands::project_scan,
            commands::project_tree,
            commands::project_generate,
            commands::agent_start,
            commands::agent_send,
            commands::agent_cancel,
            commands::agent_stop,
            commands::agent_running,
            commands::config_get,
            commands::config_save,
            commands::context_get,
            commands::context_clear,
            commands::context_clear_all,
            commands::roles_list,
            commands::roles_save,
            commands::roles_delete,
            commands::role_start,
            commands::role_send,
            commands::role_cancel,
            commands::role_stop,
            commands::role_context_get,
            commands::role_context_clear,
            commands::knowledge_list,
            commands::knowledge_read,
            commands::knowledge_save,
            commands::knowledge_delete,
            commands::workflow_list,
            commands::workflow_load,
            commands::workflow_create,
            commands::workflow_delete,
            commands::workflow_step_save,
            commands::workflow_step_delete,
            commands::workflow_step_add,
            commands::workflow_execute,
            commands::workflow_cancel,
            commands::workflow_status,
            commands::migrate_check,
            commands::migrate_data,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            log::info!("ModuleAgent 应用退出");
        }
    });
}