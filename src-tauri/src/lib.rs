pub mod acp;
pub mod agent;
pub mod config;
pub mod mcp;
pub mod module;
pub mod role;
pub mod server;
pub mod util;
pub mod workflow;

use std::sync::Mutex;
use tauri::Manager;

struct BackendState {
    port: u16,
}

#[tauri::command]
fn get_backend_port(state: tauri::State<'_, Mutex<BackendState>>) -> u16 {
    state.lock().unwrap().port
}

#[tauri::command]
async fn select_dir(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = window.dialog().file().blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let state = tauri::async_runtime::block_on(server::state::AppState::new())
                .expect("Failed to create AppState");
            let router = server::app::build_router(state);
            let listener = tauri::async_runtime::block_on(
                tokio::net::TcpListener::bind("127.0.0.1:0")
            ).expect("Failed to bind port");
            let port = listener.local_addr().unwrap().port();
            eprintln!("[tauri] Backend ready on port {}", port);
            app.manage(Mutex::new(BackendState { port }));
            tauri::async_runtime::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_port, select_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}