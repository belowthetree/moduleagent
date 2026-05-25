use tauri::Manager;
use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::io::BufRead;

struct SidecarState {
    process: Option<Child>,
    port: u16,
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.process {
            let _ = child.kill();
        }
    }
}

fn start_sidecar(app: &tauri::App) -> u16 {
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    // Try multiple paths for the sidecar bundle
    let sidecar_js = resource_dir.join("dist-backend").join("server.cjs");
    let fallback_js = std::path::PathBuf::from("dist-backend/server.cjs");

    let script_path = if sidecar_js.exists() {
        sidecar_js
    } else if fallback_js.exists() {
        fallback_js
    } else {
        eprintln!("[tauri] Sidecar not found, skipping startup");
        return 18888;
    };

    let node_cmd = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    eprintln!("[tauri] Starting sidecar: {} {}", node_cmd, script_path.display());

    let mut child = match Command::new(node_cmd)
        .arg(&script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[tauri] Failed to start sidecar: {}", e);
            return 18888;
        }
    };

    // Read the first line from stdout to get the port
    let stdout = child.stdout.take();
    let mut port = 18888u16;

    if let Some(stdout) = stdout {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    eprintln!("[sidecar] {}", l);
                    if l.starts_with("READY:") {
                        if let Ok(p) = l[6..].trim().parse::<u16>() {
                            port = p;
                            eprintln!("[tauri] Sidecar ready on port {}", port);
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }
    }

    port
}

#[tauri::command]
fn get_sidecar_port(state: tauri::State<'_, Mutex<SidecarState>>) -> u16 {
    state.lock().unwrap().port
}

#[tauri::command]
async fn select_dir(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = window
        .dialog()
        .file()
        .blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let port = start_sidecar(app);
            app.manage(Mutex::new(SidecarState {
                process: None, // We don't track the process for now; it dies with the app
                port,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_port,
            select_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
