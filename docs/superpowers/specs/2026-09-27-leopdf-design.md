# LeoPDF Reader — Design Spec

- **Date:** 2026-09-27
- **Status:** Approved (design), pending implementation plan
- **License:** AGPL-3.0-or-later

## 1. Intent

### What the owner asked for
- A PDF reader **and** editor that feels like Adobe Acrobat Reader.
- Open source.
- First-class **Sinhala** and **Tamil** support — Acrobat fails to render/edit these scripts correctly.
- Long-term goal: feature parity with Acrobat's editing tools (annotate, fill & sign, organize pages, edit existing text, and more).
- Desktop first, shipped as native installers (`.dmg` on macOS, `.exe`/`.msi` on Windows).

### Assumptions (open to correction)
- Primary users: students, government offices, lawyers, printers/publishers, and general users in Sri Lanka who handle Sinhala/Tamil/English documents.
- Users may have modest hardware, so installer size and memory use matter.
- Offline-first: no account, no cloud dependency, no telemetry by default.
- The app will evolve iteratively; the owner will review and adjust as releases land.

### Success criteria
1. Sinhala and Tamil text **typed or edited** in LeoPDF renders correctly (conjuncts, vowel signs, reph/rakaransaya, Tamil ligatures) in LeoPDF, Adobe Acrobat, Chrome, and macOS Preview.
2. Sinhala/Tamil text in PDFs produced by LeoPDF is **searchable and copies as correct Unicode**.
3. Legacy-font PDFs (e.g. FM Abhaya, Bamini) can be converted to a correct Unicode text layer.
4. Scanned Sinhala/Tamil PDFs can be OCR'd into searchable PDFs.
5. The UI is familiar to Acrobat users: top toolbar, left navigation panel, right tools pane, tabbed documents.
6. UI available in English, සිංහල, and தமிழ்.

## 2. Why Sinhala/Tamil break elsewhere (the problem we solve)

| Problem | Cause | LeoPDF answer |
|---|---|---|
| Garbled glyphs when adding/editing text | Editor lays out characters without complex-script shaping | Shape every text run with **HarfBuzz**; embed the shaped glyphs with a correct `ToUnicode` CMap |
| Copy/search returns gibberish | PDF uses legacy non-Unicode fonts (FM Abhaya, Bamini, etc.) or lacks `ToUnicode` maps | **Legacy-font mapper** converts known encodings → Unicode; rebuilds the text layer |
| Scanned documents not searchable | No text layer | **OCR** with Tesseract `sin`/`tam`/`eng` models, invisible text layer |
| Missing glyphs on the user's machine | System lacks Sinhala/Tamil fonts | Bundle **Noto Sans/Serif Sinhala** and **Noto Sans/Serif Tamil**; fall back automatically |
| Search misses matches | Different Unicode sequences for the same visual text (ZWJ usage, vowel-sign order) | Normalise (NFC + script-specific rules) both query and page text before matching |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri 2 shell (Rust)                                          │
│  file open/save, native dialogs, recent files, file-type      │
│  association, printing bridge, auto-updater, window mgmt      │
└───────────────▲──────────────────────────────────────────────┘
                │ IPC (typed commands)
┌───────────────┴──────────────────────────────────────────────┐
│ UI — React + TypeScript (Vite)                                │
│  Acrobat-style shell: tabs · top toolbar · left panel         │
│  (thumbnails / bookmarks / comments / attachments) ·          │
│  page canvas · right tools pane · status bar                  │
│  i18n: en / si / ta                                           │
└───────────────▲──────────────────────────────────────────────┘
                │ postMessage (Comlink)
┌───────────────┴──────────────────────────────────────────────┐
│ Engine Worker (Web Worker)                                    │
│  DocumentEngine  → mupdf.js (WASM)                            │
│  TextShaper      → harfbuzzjs (WASM)                          │
│  OcrEngine       → Tesseract (sin / tam / eng)                │
│  FontMapper      → legacy-encoding → Unicode tables           │
│  Normalizer      → Unicode normalisation for search           │
└──────────────────────────────────────────────────────────────┘
Bundled assets: Noto Sans/Serif Sinhala, Noto Sans/Serif Tamil,
Noto Sans (Latin); OCR models downloaded on first use.
```

### Units and interfaces

Each unit has one purpose, a small TypeScript interface, and can be tested alone.

| Unit | Responsibility | Depends on |
|---|---|---|
| `DocumentEngine` | Open/save/render pages, read text, annotations, forms, page operations, redaction | mupdf.js |
| `TextShaper` | Turn a Unicode string + font + size into positioned glyphs | harfbuzzjs, bundled fonts |
| `TextWriter` | Write shaped glyph runs into a PDF content stream with font subset + `ToUnicode` | `DocumentEngine`, `TextShaper` |
| `OcrEngine` | Image → words with bounding boxes + confidence | Tesseract |
| `FontMapper` | Detect legacy fonts; map legacy code points → Unicode | mapping tables |
| `Normalizer` | Canonicalise Sinhala/Tamil text for search and comparison | — |
| `UndoStack` | Command pattern; every edit is a reversible command | — |
| `Shell` (Rust) | Filesystem, dialogs, OS integration, updates | Tauri |

The UI never calls mupdf.js directly; it goes through `DocumentEngine` in the worker so rendering never blocks the UI thread.

### Key technology choices
- **Tauri 2** — small installers (~15–25 MB) and low memory versus Electron.
- **MuPDF (mupdf.js)** — mature rendering, annotations, forms, page ops, redaction, incremental save. AGPL-licensed, which is why LeoPDF is AGPL-3.0.
- **HarfBuzz** — the industry-standard shaping engine with full Sinhala and Tamil support.
- **Tesseract** — open OCR with existing `sin` and `tam` models; can be fine-tuned later on our own corpus.

## 4. Feature roadmap

| Release | Scope |
|---|---|
| **v0.1 Reader** | Open/close, tabbed documents, zoom/fit, single/continuous/two-page views, rotate view, thumbnails, bookmarks/outline, text selection & copy, Unicode-normalised search, print, recent files, dark mode, en/si/ta UI |
| **v0.2 Annotate + Fill & Sign** | Highlight, underline, strikethrough, sticky notes, freehand ink, shapes, text boxes with shaped Sinhala/Tamil, comments panel, AcroForm filling, signature (typed/drawn/image) stamps, save/undo/redo |
| **v0.3 Organize pages** | Merge, split, reorder (drag in thumbnails), rotate, insert blank/from file, delete, extract, crop |
| **v0.4 Language tools** | OCR scanned PDFs → searchable PDF; detect legacy fonts and rebuild Unicode text layer; "copy as Unicode"; bulk convert |
| **v0.5 Edit text** | Edit existing text blocks: select block → edit → reflow paragraph → re-shape with HarfBuzz → embed Noto subset; add/replace images |
| **Later** | Redaction, compare documents, export to DOCX/images, create PDF from images/Office files, digital signatures (PAdES), password protection, fine-tuned OCR models, mobile apps |

## 5. Error handling
- **Encrypted PDF** → password prompt; wrong password shows inline error, no crash.
- **Corrupt PDF** → MuPDF repair attempt; if repaired, show a non-blocking banner; if not, clear error with file name.
- **Missing glyphs** → fall back to bundled Noto fonts; show a small warning badge on affected text.
- **Saving** → write to a temp file, then atomic rename. Never overwrite the original if the save fails. Autosave recovery file for unsaved edits.
- **OCR model download fails** → retry option; the rest of the app keeps working offline.
- **Worker crash** → restart the worker and reopen the document from the last saved state + recovery file.

## 6. Testing
- **Unit (Vitest)** for each interface in §3.
- **Script corpus**: a versioned set of test PDFs — Unicode Sinhala, Unicode Tamil, legacy-font (FM Abhaya, Bamini), scanned, mixed-language, forms.
- **Shaping golden tests**: compare `TextShaper` glyph IDs/positions against HarfBuzz reference output for a list of hard cases (conjuncts, reph, rakaransaya, yansaya, Tamil ligatures).
- **Round-trip tests**: write Sinhala/Tamil text → save → re-extract text → must equal the input after normalisation.
- **OCR accuracy**: character error rate (CER) must stay under a threshold per corpus set; regressions fail CI.
- **E2E (Playwright + Tauri driver)** for core flows: open, search, annotate, save, reopen.
- **CI (GitHub Actions)** on Windows and macOS for every PR (Linux added when Linux builds start).

## 7. Distribution

| OS | Installer |
|---|---|
| macOS | `.dmg` (universal binary: Apple Silicon + Intel). `.pkg` optional via `productbuild`. |
| Windows | `.exe` (NSIS) and `.msi` |
| Linux | `.AppImage`, `.deb`, `.rpm` — after Windows is solid |

- **Release pipeline:** pushing a tag like `v0.1.0` triggers GitHub Actions (`tauri-action`) to build all installers and publish them to GitHub Releases. The Tauri updater reads from the same releases.
- **Signing:**
  - macOS — Apple Developer ID + notarization (US$99/yr). Until then, unsigned builds need right-click → Open; documented in the README.
  - Windows — SignPath.io (free for open source) or Azure Trusted Signing. Until then, SmartScreen shows an "unknown publisher" warning.
  - Early releases may ship unsigned; signing is required before a public launch.
- **OCR models** download on first use to keep installers small.

## 8. Non-goals (for now)
- Cloud sync, accounts, or collaboration.
- Telemetry (may be added later as strict opt-in only).
- Mobile apps (listed under "Later").

## 9. Open questions
- Which OCR models to ship first: Tesseract `best` (more accurate, larger) vs `fast`.
- Which legacy Sinhala/Tamil fonts to support first — gather a list from real user documents.
- Code-signing budget and timing.
