# LeoPDF Editing (E1 + E2) — Design Spec

- **Date:** 2026-09-28
- **Status:** Draft for owner review
- **Parent spec:** `2026-09-27-leopdf-design.md` (this replaces roadmap rows v0.2 "Annotate" text boxes and v0.5 "Edit text" for the parts below)
- **Audience:** Sri Lanka — English, Sinhala and Tamil documents

## 1. Intent

### What the owner asked for
- Edit the content of PDFs in **English, Sinhala and Tamil** — the thing Acrobat gets wrong for Sinhala/Tamil.
- All four kinds of editing eventually: fix words/lines, rewrite paragraphs, add new text, images.
- Order: **E1** (add text + images) first, then **E2** (fix existing words/lines). **E3** (paragraph reflow) later.
- First target: **Unicode** documents (made with Iskoola Pota, Nirmala UI, Noto, Latha, etc.). Legacy-font documents (FM Abhaya, DL-Manel, Bamini) come with the v0.4 converter.
- Windows and macOS builds.

### Success criteria
1. Text typed in LeoPDF (new or edited) in any of the three scripts renders with correct shaping (conjuncts, reph/rakaransaya/yansaya, kombuva, Tamil ligatures) in LeoPDF, Acrobat, Chrome and Preview.
2. That text copies and searches as the exact Unicode typed — in LeoPDF/MuPDF and Acrobat (required); in Preview/PDFKit and Chrome every word must at least be findable by search (measured, target: exact).
3. Editing never corrupts or silently loses the user's file: save is atomic; unsaved changes are never discarded without a prompt.
4. Undo/redo covers every edit.
5. Feels like Acrobat's *Edit PDF*: an **Edit** mode with boxes around editable items, click to edit in place.

### Non-goals (this spec)
- Paragraph reflow (E3), legacy-font text editing (v0.4), annotations/comments/forms/signatures (separate v0.2 work), editing text inside images (OCR, v0.4), italic scripts.

## 2. The problem and the proven approach

A PDF stores text as glyph IDs placed at positions, not as editable paragraphs. Correct Sinhala/Tamil needs **shaping**: the right glyphs, reordered and positioned. When Acrobat edits, it substitutes a font and lays out text without proper shaping, so Sinhala/Tamil break; its written text also often lacks a correct Unicode map, so copy/search fail.

**Approach (validated in a spike on 2026-09-28):**

1. **Shape** each run of text with **HarfBuzz** (`harfbuzzjs`, WASM) using a bundled Noto font for that script.
2. **Embed** the font once per document as a Type0/Identity-H font (`PDFDocument.addFont`), writing glyph IDs directly; subset on save (`subsetFonts`).
3. **Unicode layer, two ways:**
   - one `/Span <</ActualText …>> BDC … EMC` per HarfBuzz cluster (exact text for MuPDF and Acrobat — spike: exact round-trip for all three scripts);
   - a custom `/ToUnicode` CMap built from the shaping clusters, for viewers that ignore ActualText (Preview/PDFKit, some others).
4. **Remove** original text (E2) with MuPDF text-only redaction (`applyRedactions` with images and line art untouched) — spike: removes exactly the line's glyphs.

Spike findings to carry into the build:
- One `Tm` per glyph makes PDFKit insert spaces between glyphs; write runs with `TJ` and advance adjustments instead.
- A glyph must map to one string in the whole font's ToUnicode; glyphs reused with different meanings (e.g. vowel-sign parts in multi-glyph clusters) must fall back to ActualText only.
- Noto Sans Sinhala looks slightly larger than Sinhala MN at the same point size; match x-height when replacing text in E2.

## 3. User experience

### Edit mode (shared by E1 and E2)
- Toolbar gets an **Edit** toggle (Acrobat's "Edit PDF"). In Edit mode a secondary bar shows: **Add text**, **Add image**, font (Sans / Serif), size, bold, colour, and **Save**.
- Undo / Redo (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z) and Save (⌘/Ctrl+S) / Save As (⌘/Ctrl+Shift+S) work in and out of Edit mode.
- Tabs with unsaved changes show "•". Closing such a tab or quitting the app asks: Save / Don't save / Cancel.
- Everything is localised (en/si/ta).

### E1 — add and place
- **Add text:** click on the page → an inline editor appears (browser input using the same Noto font, so what you type is shaped as you type). Type any mix of English/Sinhala/Tamil. Click outside or press ⌘/Ctrl+Enter to place it; Esc cancels. Enter starts a new line (no automatic wrapping in E1).
- **Added items are objects:** in Edit mode, text boxes and images added by LeoPDF show a frame; drag to move, drag corner handles to resize (images) / change font size (text), Delete key removes, double-click a text box to edit its text.
- **Add image:** pick PNG/JPEG → placed at page centre at natural size (scaled down to fit) → move/resize like above.
- **Existing images** (already in the PDF): in Edit mode they show a frame too; **Delete**, **Replace** (pick a new file, same box), and **Move/Resize** (implemented as remove + re-add of the same image).

### E2 — fix existing words and lines
- In Edit mode, existing text lines show a light box on hover.
- Click a line → the inline editor opens over it, prefilled with the line's text, in a matching Noto font (serif/sans, bold from the original), size (x-height matched) and colour.
- Enter / click outside applies; Esc cancels. The whole line is replaced (original glyphs removed, new text written on the same baseline and start point).
- If the new text is longer than the original line and runs past the text column's right edge, a small warning chip appears ("Text runs past the column — paragraph reflow comes in a later version").
- Lines in **legacy fonts** (detected by font name — FM*, DL-*, Bamini, Kaputa, etc. — or by Sinhala-looking glyphs that extract as Latin letters) show a locked box: "This text uses a legacy font and can't be edited yet."
- Lines whose extracted text is empty/garbled (no Unicode mapping) are also locked with a short explanation.

## 4. Architecture

New units follow the existing pattern: pure, tested TypeScript in the worker; thin React UI.

```
UI (React)
  EditToolbar · EditOverlay (boxes, handles, inline editor) · useUnsavedGuard
      │ Comlink
Engine worker
  DocumentEngine ── existing (render, search, select …) + edit entry points
  FontRegistry      bundled Noto fonts; picks font by script/style; loads bytes once
  ScriptSplitter    splits text into runs: Sinhala / Tamil / Latin(+digits, punctuation)
  TextShaper        harfbuzzjs: run → glyphs (gid, advance, offsets, cluster)
  TextWriter        shaped runs → PDF content (TJ runs, per-cluster ActualText,
                    ToUnicode bookkeeping, colour, baseline); per-doc embedded font cache
  PageObjects       LeoPDF-owned objects on a page: each added text box / image lives in its
                    own content stream wrapped in /LeoPDF <</Id …>> BDC … EMC; list / move /
                    rewrite / delete them
  LineFinder        text lines from the text layer: bbox, baseline, font name, size, colour,
                    serif/bold flags, legacy/garbled detection
  LineEditor        E2: redact line (text only) → write new line via TextWriter
  ImageEditor       existing images: locate (text layer image blocks), delete (image-only
                    redaction), replace/move (delete + add)
  History           MuPDF journal: beginOperation/endOperation, undo/redo, dirty flag
Shell (Rust)
  write_file(path, bytes)  temp file + fsync + atomic rename; refuses non-.pdf paths
  Save As dialog (plugin-dialog save), quit-with-unsaved guard (close-requested event)
```

### Key interfaces (TypeScript, worker side)
- `TextStyle = { family: "sans" | "serif"; bold: boolean; size: number; color: [r, g, b] }`
- `shapeText(text: string, style: TextStyle): ShapedLine` — runs of `{ font: FontKey, glyphs: { gid, xAdvance, xOffset, yOffset, cluster }[], text }`
- `writeShapedLine(doc, page, shaped, origin: Point /* baseline start, page coords */): void`
- `listPageObjects(docId, page): PageObject[]` where `PageObject = { id, kind: "text" | "image", bounds: Rect, text?: string, style?: TextStyle }`
- `addText(docId, page, origin, text, style) → id`, `updateText(docId, page, id, text, style)`, `moveObject(docId, page, id, bounds)`, `deleteObject(docId, page, id)`
- `addImage(docId, page, bytes, bounds) → id`
- `listLines(docId, page): EditableLine[]` — `{ id, bounds, baseline: Point, text, style, locked?: "legacy" | "no-unicode" }`
- `replaceLine(docId, page, lineId, text, style)`
- `listImages(docId, page): { id, bounds }[]`, `deleteImage`, `replaceImage`
- `undo(docId)`, `redo(docId)`, `history(docId): { canUndo, canRedo, dirty }`
- `save(docId): Uint8Array` (incremental when possible, else full rewrite with font subsetting)

Every edit call runs inside one journal operation, invalidates the page's cached text/search data, and bumps a per-page **revision** so the UI re-renders only that page.

### Fonts bundled
Noto Sans / Noto Serif × Regular / Bold for Latin, Sinhala, Tamil (12 TTF files, ~4–5 MB, SIL OFL). Loaded lazily in the worker on first edit.

## 5. Data flow examples

**Add Sinhala text (E1):** click page → UI opens inline editor at point → user types `ශ්‍රී ලංකාව` → commit → `addText` → ScriptSplitter (1 Sinhala run) → TextShaper (HarfBuzz, Noto Sans Sinhala) → TextWriter writes a new content stream `/LeoPDF <</Id t3>> BDC q BT … TJ … ET Q EMC` with per-cluster ActualText → journal op "Add text" → page revision++ → UI re-renders page.

**Fix a word in an existing line (E2):** hover shows line boxes (`listLines`) → click line → editor prefilled with line text and style → user changes a name → commit → `replaceLine` → redact line bbox (text only) → write new line at original baseline/start → journal op "Edit text" → re-render.

## 6. Error handling
- **Save failure** (disk full, permission): original file untouched (temp + rename); message offers Save As.
- **Font missing a glyph** (e.g. a character outside Sinhala/Tamil/Latin): fall back to the next bundled font that has it; if none, show a warning chip and render a notdef box (never silently drop characters).
- **Encrypted PDFs with edit restrictions** (`hasPermission("edit")` false): Edit mode is disabled with an explanation.
- **Signed PDFs:** editing invalidates signatures — warn before the first edit.
- **Redaction removes more than the line** (overlapping text): detected by comparing text before/after outside the line box; the edit is undone and the line is locked with an explanation.
- **Worker crash during edit:** unsaved edits are lost; the tab reloads the last saved file and shows a notice (autosave/recovery file is a later improvement).

## 7. Testing
- **Unit (Vitest, Node):** ScriptSplitter (mixed strings, digits, punctuation, ZWJ/ZWNJ), TextShaper (glyph ID golden files vs direct HarfBuzz for the hard-case list), TextWriter (content syntax, ActualText per cluster, ToUnicode consistency).
- **Round-trip (required):** for a corpus of Sinhala, Tamil, English and mixed strings — write → save → reopen with MuPDF → extracted text equals input (after the search normaliser) and every word is found by search.
- **Second-engine check (measured):** the same PDFs through macOS PDFKit (script in CI on macOS) — every word findable; exact-match rate reported.
- **E2:** replace a line in the Chrome fixture and a Word-generated fixture (Iskoola Pota / Nirmala) → only that line's text changes; other lines' text and images unchanged; legacy-font fixture lines report `locked: "legacy"`.
- **Images:** add/move/resize/delete/replace; existing-image delete removes only that image.
- **History:** every edit undoable/redoable; dirty flag correct; save clears dirty.
- **Save:** atomic write test in Rust (simulate failure → original intact); saved file reopens in MuPDF.
- **UI:** Edit toolbar, inline editor commit/cancel, unsaved-changes prompt (jsdom tests); manual check in the built app on macOS and Windows, including opening results in Acrobat.

## 8. Delivery
- **E1 build:** Edit mode, add/move/resize/delete text boxes and images, existing-image delete/replace/move, undo/redo, Save/Save As, unsaved guard.
- **E2 build:** line finding, legacy/garbled locking, line replacement with style matching.
- Each ends with Windows + macOS test installers via the "Build installers" workflow.

## 8a. E2 findings from real documents (2026-09-30)
Checked against 38 owner-supplied Sinhala/Tamil PDFs (Word, PowerPoint, InDesign, Illustrator, Chrome):
- **Most are legacy fonts** (FM*, DL-*, Abhaya/Basuru/Derana/A-KELANI, SINHAMethsara, Kalaham, Bamini/Baamini, Tharmini, Kamalam, RAVIB …): these lines are locked. A line is never locked if its text contains real Sinhala/Tamil code points, whatever the font is called (Apple's "Sinhala MN", "Abhaya Libre" are Unicode).
- **Word/PowerPoint (Iskoola Pota) extract in visual order** ("ෙසෟඛ්‍ය"): pre-base vowel signs are moved back after their consonant cluster and two-part signs joined, for fonts that show a word-initial pre-base sign on the page. Stray spaces before vowel signs and a doubled kombuva ("පෙෝ") are cleaned up. Some glyph→Unicode maps are simply wrong (Latha "இலங்ககயர்"); the user corrects those in the editor.
- **Size:** instead of x-height matching, the Noto size is chosen so the original text spans the original line width (clamped 0.7–1.15×); Times 12 → Noto Serif ≈10.3.
- **Overlap:** big background letters / rotated letters overlap many lines; those edits are refused with a message and nothing changes.
- A replaced line becomes an ordinary LeoPDF text object (movable, re-editable).

## 9. Open questions
- Exact list of legacy font names to lock (gather from real Sri Lankan documents; start with FM*, DL-*, Bamini, Kaputa, Thibus).
- Whether to also embed a Serif Sinhala font style closer to Iskoola Pota (Noto Serif Sinhala is the default).
