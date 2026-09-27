use tauri::ipc::Response;

/// Reads a PDF from disk. Refuses anything that is not a `.pdf` path.
fn read_pdf_bytes(path: &str) -> Result<Vec<u8>, String> {
    if !path.to_lowercase().ends_with(".pdf") {
        return Err(format!("{path}: not a PDF file"));
    }
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    read_pdf_bytes(&path).map(Response::new)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running LeoPDF Reader");
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
}
