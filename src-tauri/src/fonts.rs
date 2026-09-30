//! Fonts installed on this computer, so edited text can use the same font as the original PDF.
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Response;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub path: String,
    /// Face index inside a .ttc collection (0 for single fonts).
    pub index: u32,
    pub family: String,
    pub postscript: String,
    pub bold: bool,
    pub italic: bool,
    pub sinhala: bool,
    pub tamil: bool,
}

/// Fonts found by the first `list_fonts` call (scanning is slow-ish, so it happens once per run).
#[derive(Default)]
pub struct FontCache(Mutex<Option<Vec<SystemFont>>>);

/// Bigger files are CJK collections, irrelevant here and slow to read.
const MAX_FONT_BYTES: u64 = 40 * 1024 * 1024;

fn font_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/Library/Fonts"].map(PathBuf::from));
        // Microsoft Office for Mac ships Iskoola Pota, Latha, Vijaya … inside the app bundles.
        for app in ["Microsoft Word", "Microsoft PowerPoint", "Microsoft Excel"] {
            dirs.push(PathBuf::from(format!("/Applications/{app}.app/Contents/Resources/DFonts")));
        }
        dirs.extend(home.map(|h| h.join("Library/Fonts")));
    } else if cfg!(windows) {
        let windir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        dirs.push(windir.join("Fonts"));
        dirs.extend(std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join("Microsoft\\Windows\\Fonts")));
    } else {
        dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        dirs.extend(home.map(|h| h.join(".local/share/fonts")));
    }
    dirs
}

fn is_font_file(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref(), Some("ttf" | "otf" | "ttc"))
}

fn collect_files(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && depth > 0 {
            collect_files(&path, depth - 1, out);
        } else if is_font_file(&path) && entry.metadata().map(|m| m.len() <= MAX_FONT_BYTES).unwrap_or(false) {
            out.push(path);
        }
    }
}

fn name(face: &ttf_parser::Face, ids: &[u16]) -> Option<String> {
    ids.iter().find_map(|id| {
        face.names().into_iter().filter(|n| n.name_id == *id && n.is_unicode()).find_map(|n| n.to_string())
    })
}

/// Every face in one font file.
pub fn faces_in(path: &Path, data: &[u8]) -> Vec<SystemFont> {
    let count = ttf_parser::fonts_in_collection(data).unwrap_or(1);
    (0..count)
        .filter_map(|index| {
            let face = ttf_parser::Face::parse(data, index).ok()?;
            let style = name(&face, &[17, 2]).unwrap_or_default().to_lowercase();
            Some(SystemFont {
                path: path.to_string_lossy().into_owned(),
                index,
                // Typographic family (16) groups Bold/Italic under one name; older fonts only have 1.
                family: name(&face, &[16, 1])?,
                postscript: name(&face, &[6]).unwrap_or_default(),
                // Apple's fonts often leave the OS/2 flags unset; the style name still says "Bold".
                bold: face.is_bold() || style.contains("bold"),
                italic: face.is_italic() || style.contains("italic") || style.contains("oblique"),
                sinhala: face.glyph_index('අ').is_some(),
                tamil: face.glyph_index('அ').is_some(),
            })
        })
        .collect()
}

fn scan() -> Vec<SystemFont> {
    let mut files = Vec::new();
    for dir in font_dirs() {
        collect_files(&dir, 3, &mut files);
    }
    let mut fonts: Vec<SystemFont> = files.iter().filter_map(|p| std::fs::read(p).ok().map(|d| faces_in(p, &d))).flatten().collect();
    // Hidden system fonts (".SF Tamil") aren't meant for documents; Office apps each ship the same fonts.
    fonts.retain(|f| !f.family.starts_with('.'));
    let mut seen = std::collections::HashSet::new();
    fonts.retain(|f| seen.insert((f.family.clone(), f.postscript.clone(), f.bold, f.italic)));
    fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()).then(a.bold.cmp(&b.bold)).then(a.italic.cmp(&b.italic)));
    fonts
}

#[tauri::command]
pub async fn list_fonts(cache: tauri::State<'_, FontCache>) -> Result<Vec<SystemFont>, String> {
    if let Some(fonts) = cache.0.lock().unwrap().clone() {
        return Ok(fonts);
    }
    let fonts = tauri::async_runtime::spawn_blocking(scan).await.map_err(|e| e.to_string())?;
    *cache.0.lock().unwrap() = Some(fonts.clone());
    Ok(fonts)
}

/// Reads a font file, but only one that `list_fonts` found (never an arbitrary path).
#[tauri::command]
pub fn read_font(path: String, cache: tauri::State<'_, FontCache>) -> Result<Response, String> {
    let known = cache.0.lock().unwrap().as_ref().is_some_and(|fonts| fonts.iter().any(|f| f.path == path));
    if !known {
        return Err(format!("{path}: not an installed font"));
    }
    std::fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_names_and_coverage_of_a_bundled_noto_font() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/@expo-google-fonts/noto-sans-sinhala/700Bold/NotoSansSinhala_700Bold.ttf");
        let faces = faces_in(&path, &std::fs::read(&path).unwrap());
        assert_eq!(faces.len(), 1);
        let f = &faces[0];
        assert_eq!(f.family, "Noto Sans Sinhala");
        assert!(f.bold && !f.italic && f.sinhala && !f.tamil);
    }

    #[test]
    fn ignores_non_font_files() {
        assert!(!is_font_file(Path::new("/x/readme.txt")));
        assert!(is_font_file(Path::new("C:\\Windows\\Fonts\\iskpota.TTF")));
    }
}

