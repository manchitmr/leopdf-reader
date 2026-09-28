use std::io::Write;
use std::path::Path;
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

fn has_extension(path: &str, allowed: &[&str]) -> bool {
    let lower = path.to_lowercase();
    allowed.iter().any(|ext| lower.ends_with(ext))
}

/// Writes `bytes` to `path` atomically: temp file in the same folder, fsync, then rename over the target.
/// On any error the original file is left untouched and the temp file is removed.
fn write_pdf_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let shown = path.display().to_string();
    if !has_extension(&shown, &[".pdf"]) {
        return Err(format!("{shown}: not a PDF file"));
    }
    let tmp = path.with_extension("pdf.leopdf-tmp");
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{shown}: {e}"));
    }
    Ok(())
}

/// Saves a PDF. The body is the raw file bytes; the target path comes percent-encoded in `x-path`.
#[tauri::command]
fn write_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing x-path header")?;
    let path = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    write_pdf_atomic(Path::new(path.as_ref()), bytes)
}

#[tauri::command]
fn read_image(path: String) -> Result<Response, String> {
    if !has_extension(&path, &[".png", ".jpg", ".jpeg"]) {
        return Err(format!("{path}: not a PNG or JPEG image"));
    }
    std::fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
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
        .invoke_handler(tauri::generate_handler![read_file, print_window, take_pending_files, write_file, read_image])
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

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("leopdf-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = temp_dir("write");
        let file = dir.join("out.pdf");
        write_pdf_atomic(&file, b"one").unwrap();
        write_pdf_atomic(&file, b"two").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"two");
        assert!(!dir.join("out.pdf.leopdf-tmp").exists());
    }

    #[test]
    fn failed_write_leaves_original_and_no_temp() {
        let dir = temp_dir("fail");
        let missing = dir.join("no-such-folder").join("out.pdf");
        assert!(write_pdf_atomic(&missing, b"x").is_err());
        assert!(!dir.join("no-such-folder").exists());
    }

    #[test]
    fn write_refuses_non_pdf() {
        let dir = temp_dir("ext");
        assert!(write_pdf_atomic(&dir.join("notes.txt"), b"x").unwrap_err().contains("not a PDF"));
    }

    #[test]
    fn pdf_args_skips_executable_and_non_pdfs() {
        let args = ["leopdf", "--flag", "/a/b.PDF", "notes.txt", "C:\\x.pdf"].map(String::from);
        assert_eq!(pdf_args(args), vec!["/a/b.PDF".to_string(), "C:\\x.pdf".to_string()]);
    }
}
