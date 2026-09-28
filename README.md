# LeoPDF Reader

**A free, open-source PDF reader and editor with first-class Sinhala and Tamil support.**

සිංහලෙන් සහ දෙමළෙන් PDF කියවන්න, සංස්කරණය කරන්න.
சிங்களம் மற்றும் தமிழில் PDF-களைப் படிக்கவும் திருத்தவும்.

> **Status:** early design stage. No release yet. See the [design spec](docs/superpowers/specs/2026-09-27-leopdf-design.md).

## Why

Popular PDF tools, including Adobe Acrobat, break Sinhala and Tamil text when you add or edit it: vowel signs land in the wrong place, conjuncts fall apart, and copy/search returns gibberish. LeoPDF is built around correct complex-script handling from day one.

- **Correct shaping** — every piece of text is shaped with [HarfBuzz](https://harfbuzz.github.io/), so conjuncts, reph, rakaransaya, yansaya and Tamil ligatures render properly.
- **Searchable, copyable text** — text we write carries a correct Unicode map, so it stays searchable in any PDF viewer.
- **Legacy font rescue** — convert PDFs made with FM Abhaya, Bamini and similar legacy fonts into proper Unicode text.
- **OCR** — make scanned Sinhala, Tamil and English documents searchable.
- **Bundled fonts** — Noto Sinhala and Noto Tamil ship with the app, so it works even on machines without these fonts.
- **Familiar** — Acrobat-style layout: tabs, top toolbar, thumbnails and bookmarks on the left, tools on the right.
- **Private** — works fully offline. No account, no tracking.
- **UI in English, සිංහල and தமிழ்.**

## Roadmap

| Release | Features |
|---|---|
| v0.1 Reader | Tabs, zoom, page views, thumbnails, bookmarks, search, copy, print, dark mode |
| v0.2 Annotate + Fill & Sign | Highlight, notes, ink, shapes, text boxes, form filling, signatures, undo/redo |
| v0.3 Organize pages | Merge, split, reorder, rotate, insert, delete, extract, crop |
| v0.4 Language tools | OCR, legacy-font → Unicode conversion, copy as Unicode |
| v0.5 Edit text | Edit existing text and images with correct Sinhala/Tamil shaping |
| Later | Redaction, compare, export to Word/images, digital signatures, mobile |

## Downloads (planned)

| OS | Installer |
|---|---|
| macOS | `.dmg` (Apple Silicon + Intel) |
| Windows | `.exe` and `.msi` |
| Linux | Planned after Windows |

Installers will be published on the [Releases](../../releases) page.

## Tech stack

[Tauri 2](https://tauri.app/) (Rust) · React + TypeScript · [MuPDF](https://mupdf.com/) (WASM) · [HarfBuzz](https://harfbuzz.github.io/) · [Tesseract](https://github.com/tesseract-ocr/tesseract) · [Noto fonts](https://fonts.google.com/noto)

## Contributing

Contributions are welcome, especially from Sinhala and Tamil speakers: test documents, legacy font samples, translations, and bug reports all help. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE). LeoPDF uses MuPDF, which is AGPL-licensed.

## Development

Requirements: Node.js 22+, Rust (stable, via [rustup](https://rustup.rs)), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # run the desktop app
npm test               # unit tests
npm run tauri build    # build installers for your OS
```

`npm run dev` also runs the UI in a normal browser at http://localhost:1420 (file picker instead of native dialogs), which is handy for quick UI work.

### Opening unsigned builds

Early releases are not code-signed yet.
- **macOS:** right-click the app → Open → Open.
- **Windows:** on the SmartScreen warning click "More info" → "Run anyway".

### Test builds

Maintainers can build installers without making a release: GitHub → Actions → **Build installers** → *Run workflow* (Windows, macOS or both). The `.exe`/`.msi`/`.dmg` files appear under the run's *Artifacts*.
