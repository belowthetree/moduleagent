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

    let exe_name = if cfg!(target_os = "windows") {
        "module-agent-backend.exe"
    } else {
        "module-agent-backend"
    };

    let sidecar_bin = resource_dir.join("dist-backend").join(exe_name);
    let fallback_bin = std::path::PathBuf::from("dist-backend").join(exe_name);
    let dev_bin = std::path::PathBuf::from("target/debug").join(exe_name);

    let bin_path = if sidecar_bin.exists() {
        sidecar_bin
    } else if fallback_bin.exists() {
        fallback_bin
    } else if dev_bin.exists() {
        dev_bin
    } else {
        eprintln!("[tauri] Rust sidecar not found, skipping startup");
        return 18888;
    };

    eprintln!("[tauri] Starting sidecar: {}", bin_path.display());

    let mut child = match Command::new(&bin_path)
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
                process: None,
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