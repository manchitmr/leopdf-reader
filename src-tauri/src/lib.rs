use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{Emitter, Manager};

/// Files the OS asked us to open before the UI could take them.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

/// Reads a PDF from disk. Refuses anything that is not a `.pdf` path.
fn read_pdf_bytes(path: &str) -> Result<Vec<u8>, String> {
    if !path.to_lowercase().ends_with(".pdf") {
        return Err(format!("{path}: not a PDF file"));
    }
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

/// PDF paths from a command line (the first argument is the executable).
fn pdf_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter().skip(1).filter(|a| a.to_lowercase().ends_with(".pdf")).collect()
}

fn queue_files(app: &tauri::AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    app.state::<PendingFiles>().0.lock().unwrap().extend(files);
    let _ = app.emit("open-files", ());
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    read_pdf_bytes(&path).map(Response::new)
}

#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            queue_files(app, pdf_args(argv));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFiles::default())
        .setup(|app| {
            queue_files(app.handle(), pdf_args(std::env::args()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, print_window, take_pending_files])
        .build(tauri::generate_context!())
        .expect("error while building LeoPDF Reader");

    app.run(|_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let files = urls
                .into_iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            queue_files(_handle, files);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_existing_pdf() {
        let path = std::env::temp_dir().join("leopdf-read-test.pdf");
        std::fs::write(&path, [1u8, 2, 3]).unwrap();
        assert_eq!(read_pdf_bytes(path.to_str().unwrap()).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn missing_file_error_names_the_path() {
        let err = read_pdf_bytes("/definitely/not/here.pdf").unwrap_err();
        assert!(err.contains("/definitely/not/here.pdf"));
    }

    #[test]
    fn refuses_non_pdf_paths() {
        assert!(read_pdf_bytes("/etc/passwd").unwrap_err().contains("not a PDF"));
    }

    #[test]
    fn pdf_args_skips_executable_and_non_pdfs() {
        let args = ["leopdf", "--flag", "/a/b.PDF", "notes.txt", "C:\\x.pdf"].map(String::from);
        assert_eq!(pdf_args(args), vec!["/a/b.PDF".to_string(), "C:\\x.pdf".to_string()]);
    }
}
