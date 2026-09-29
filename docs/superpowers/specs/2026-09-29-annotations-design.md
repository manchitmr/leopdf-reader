# LeoPDF Annotations & Tool Rail — Design Spec

- **Date:** 2026-09-29
- **Status:** Approved in conversation (owner: "write the spec and start building")
- **Parent specs:** `2026-09-27-leopdf-design.md` (roadmap v0.2 "Annotate" and v0.3 "Fill & sign" — visual signature part), `2026-09-28-editing-design.md` (E1 edit mode, journal undo, atomic save)
- **Audience:** Sri Lanka — English, Sinhala and Tamil

## 1. Intent

### What the owner asked for
- An Acrobat-style **vertical tool rail** on the left (from the owner's Acrobat screenshot: Select, Comment, Highlight, Draw, Add text, Sign, …).
- First annotation tools: **Highlight & markup, Comments, Draw, Sign**.
- Built before E2 (fix existing words/lines).

### Success criteria
1. Highlight / underline / strikethrough follow the text the user drags over — including Sinhala and Tamil lines — and look right in LeoPDF, Acrobat, Chrome and Preview.
2. Comments (sticky notes, and comments attached to any markup) accept English/Sinhala/Tamil text; it is stored as Unicode and reads back exactly in LeoPDF and Acrobat.
3. Everything is a **standard PDF annotation**, so Acrobat and other readers show, edit and delete it; comments made in Acrobat show up in LeoPDF's Comments panel.
4. A user can create a signature once (draw, type, or import a picture) and place it on any PDF with one click; it survives save and prints.
5. Undo/redo, unsaved-changes prompts and atomic save behave exactly as for E1 edits.

### Non-goals (this spec)
- Certified (cryptographic) digital signatures — roadmap, separate spec.
- Comment replies/threads, text-box (FreeText) and callout annotations, stamps library ("Approved", …), measuring tools, eraser (delete a stroke instead), filled shapes, flatten, FDF/XFDF import/export, Snapshot, a floating quick-action menu on text selection.

## 2. What we verified (probe, 2026-09-29, mupdf.js 1.28)

- Annotation geometry APIs (`setRect`, `setQuadPoints`, `setInkList`, `setLine`, `getBounds`) use **page space** — y down, page rotation applied — the same space the viewer and E1 use. On a `/Rotate 90` page the stored `/Rect` is converted correctly.
- `StructuredText.highlight(a, b)` returns per-line quads for a drag; used directly as markup QuadPoints (works on the Sinhala/Tamil fixture).
- Highlight/Underline/StrikeOut have **no Rect** (`getRect` throws) → always use `getBounds()` for display rects.
- Annotation **object numbers are stable** across journal undo/redo → used as annotation ids.
- `createAnnotation`, property changes and deletion are journaled: `undo`/`redo` add/remove them correctly.
- `setContents`/`setAuthor` round-trip Sinhala/Tamil (incl. ZWJ) through save + reopen.
- Stamp + `setStampImage(new Image(png))` keeps PNG transparency (SMask); `setRect` + `update()` rescales the image appearance.
- MuPDF renders annotations in `toPixmap(..., showExtras = true)`, which render/print already use.

## 3. User experience

### Tool rail (left edge, only when a document is ready)
Vertical icon buttons with a short label under each, like Acrobat:

| Rail item | Tool | Behaviour |
|---|---|---|
| **Select** | `select` | Select text (as today) and click annotations to select them. |
| **Comment** | `comment` | Click the page → sticky note placed, its comment box opens. |
| **Highlight** | `markup` | Drag over text → highlight / underline / strikethrough (picked in the options bar). |
| **Draw** | `draw` | Pen (freehand), line, arrow, rectangle, oval. |
| **Add text** | E1 edit mode, text tool | Same as E1's "Add text". |
| **Sign** | `sign` | Pick a saved signature (or create one), click to place. |
| **Edit PDF** | E1 edit mode, select-objects tool | Same as E1's Edit mode. |

- The top toolbar loses its **Select text** and **Edit PDF** buttons (now on the rail); **Hand** stays in the top toolbar next to zoom.
- Picking an annotation tool leaves Edit mode (committing any open inline text); entering Edit mode sets the tool back to Select.
- **Options bar:** when Highlight, Draw or Sign is active, a slim bar under the toolbar (same place as E1's EditBar) shows its options:
  - Highlight: highlight / underline / strikethrough + 5 colours (yellow default for highlight, red for underline/strikethrough).
  - Draw: pen / line / arrow / rectangle / oval + 5 colours (red default) + thickness 1 / 2 / 4 / 8 pt (2 default).
  - Sign: the saved signatures as thumbnails (click to choose, × to delete) and **Add signature**.
- Tool choices (kind, colours, widths) are remembered for the session.
- Esc returns to the Select tool (and clears an annotation selection).

### Selecting and changing annotations (Select tool)
- Clicking an annotation selects it (hit test: markup quads; ink/line near the stroke; others inside the box). Otherwise the click starts text selection as before.
- A selected annotation shows a frame and a **comment card** next to it: type label, author · date, a text box for the comment, colour swatches (markup/draw), **Delete**.
- Drag a selected ink / line / arrow / rectangle / oval / note / signature to move it. Rectangle, oval and signature have a corner handle to resize (signature keeps its aspect ratio). Markup is not movable (it belongs to its text).
- Delete / Backspace (not in a text box) deletes the selected annotation.
- The comment text is saved when the text box loses focus or on ⌘/Ctrl+Enter — one undo step per change.

### Comments panel
- A third tab in the left panel (after Pages and Bookmarks): **Comments**.
- Lists every annotation in the document except links, form fields and popups, grouped by page: icon, author · date, and the comment (or the type name if empty).
- Click → jump to the page, switch to Select, select that annotation.
- Header: **Your name** (editable) — used as the author of new annotations.
- Empty state: "No comments yet".

### Author name
- The first time the user picks an annotation tool, a small dialog asks "Your name for comments" (OK / Skip). Skip stores an empty name and never asks again; it can be changed later in the Comments panel. Stored locally (`localStorage`).

### Signatures
- **Add signature** dialog with three tabs:
  - **Draw:** draw with mouse/trackpad on a pad; Clear.
  - **Type:** type a name in English, Sinhala or Tamil; choose Sans or Serif. Rendered with the bundled Noto fonts by the browser engine, so Sinhala/Tamil are shaped correctly.
  - **Image:** pick a PNG/JPEG (photo or scan); "Remove white background" (on by default) makes near-white pixels transparent.
- Result is trimmed to the ink and saved as a PNG on this computer (`localStorage`, max 5; oldest dropped with a notice). Never uploaded anywhere.
- Place: with a signature chosen, a ghost follows the pointer; click places it (150 pt wide, centred on the click). The tool then returns to Select with the new signature selected so it can be moved/resized.
- It is a **visual signature** (like signing on paper, same as Acrobat "Fill & Sign"), not a certified digital signature. The UI does not call it "digital".

### Permissions and signed PDFs
- Annotation tools need the PDF "annotate" permission; otherwise picking one shows a notice.
- On a digitally signed PDF, the first annotation tool pick shows the existing warning dialog (saving rewrites the file and invalidates the signature). Acknowledging covers Edit mode and annotation tools for that tab.

### Localisation
All new strings in en/si/ta. The si/ta strings need native-speaker review (tracked with the E1 strings).

## 4. Architecture

```
UI (main thread)                                   Worker (MuPDF)
ToolRail ─┐                                        DocumentEngine
ToolOptionsBar ─┤ store: tool, markup, draw,          ├─ addAnnotation / updateAnnotation
CommentsPanel ─┤  signatureId, selectedAnnot,      ├─ moveAnnotation / resizeAnnotation
AnnotationLayer ─┤  author, signatures              ├─ deleteAnnotation / listAnnotations
SignatureDialog ─┘       │                          └─ DocumentEditor (journal, same undo stack as E1)
             annot-actions.ts ── Comlink ─────────▶    └─ edit/annotations.ts (pure MuPDF functions)
```

### Worker side
- `src/edit/annotations.ts` — pure functions over `mupdf.PDFPage` (+ `EditContext`), no state:
  - `listAnnotations(page, pageIndex): Annot[]`
  - `addAnnotation(ctx, spec: NewAnnot, author): number | null` (null when a markup drag covers no text)
  - `updateAnnotation(ctx, id, patch: { contents?: string; color?: RGB })`
  - `moveAnnotation(ctx, id, dx, dy)`, `resizeAnnotation(ctx, id, rect)`, `deleteAnnotation(ctx, id)`
  - Lookup by object number: `page.getAnnotations().find(a => a.getObject().asIndirect() === id)`; missing → error.
  - Move: shift ink list / line / vertices / rect (whichever the type has) and the popup rect; markup → error.
- `DocumentEditor` gets thin journaled wrappers (`op("Add comment", …)` etc.) returning `EditResult` with `id` = `String(objectNumber)`.
- `DocumentEngine` exposes them through `edit()` (which clears the cached text layers), plus `listAnnotations(docId, page?)` (all pages when `page` is omitted; reads without creating the editor).
- `DocInfo.annotatable = isPDF && hasPermission("annotate")`.

### Types (`src/edit/types.ts`)
```ts
export type RGB = [number, number, number];
export type AnnotKind = "highlight" | "underline" | "strikeout" | "ink" | "line" | "arrow" | "rect" | "oval" | "note" | "stamp" | "other";

export interface Annot {
  id: number;            // PDF object number
  page: number;
  kind: AnnotKind;
  subtype: string;       // PDF /Subtype, for "other"
  rect: Rect;            // getBounds(), page space
  quads?: Quad[];        // markup
  strokes?: Point[][];   // ink (line/arrow: one 2-point stroke)
  color: RGB | null;
  contents: string;
  author: string;
  modified: number | null; // ms since epoch
  movable: boolean;
  resizable: boolean;
}

export type NewAnnot =
  | { kind: "highlight" | "underline" | "strikeout"; from: Point; to: Point; color: RGB }
  | { kind: "ink"; strokes: Point[][]; color: RGB; width: number }
  | { kind: "line" | "arrow"; from: Point; to: Point; color: RGB; width: number }
  | { kind: "rect" | "oval"; rect: Rect; color: RGB; width: number }
  | { kind: "note"; at: Point; contents: string }
  | { kind: "stamp"; rect: Rect; png: Uint8Array };
```
- Note: `Text` annotation, icon `Comment`, 20×20 pt box centred on the click, yellow.
- Arrow: `Line` with line endings `None` / `OpenArrow`.
- Stamp: `Stamp` with `setStampImage`, `/Name /LeoPDFSignature`, subject "Signature".
- All new annotations: author, creation/modification date, `update()`.

### Main-thread side
- **Store** (`src/state/store.ts`):
  - `Tool = "select" | "hand" | "comment" | "markup" | "draw" | "sign"`.
  - `markupStyle { kind, colors per kind }`, `drawStyle { shape, color, width }`, `signatureId`.
  - `selectedAnnot: { tabId, page, id } | null`, `commentFocus` (open the card's text box after placing a note).
  - `author: string | null` and `signatures: SavedSignature[]` — persisted in `localStorage` by the existing settings subscriber.
  - `leftPanel` gains `"comments"`; `dialog` gains `{ kind: "author" }`; the `signed` dialog carries what to do after "Continue" (`{ editMode: true }` or `{ tool }`).
  - `setTool` clears `selectedAnnot`; entering Edit mode sets `tool: "select"`; picking a non-select/hand tool turns Edit mode off.
- **`src/app/annot-actions.ts`** (same dependency-injection pattern as `edit-actions.ts`): `chooseTool` (permission → signed → author gating), `addAnnot`, `updateAnnotContents`, `setAnnotColor`, `moveAnnot`, `resizeAnnot`, `deleteSelectedAnnot`, `placeSignature`. All go through `runEdit`, so history, dirty dot, re-render and notices work unchanged.
- **`src/viewer/annot-geometry.ts`** — pure: `hitTest(annots, point, tolerance)`, `distanceToPolyline`, `dragRect(from, to)`, `fitSignature(at, width, aspect)`.
- **`src/viewer/AnnotationLayer.tsx`** — per page, when not in Edit mode. Loads `listAnnotations(tab, page)` on `revision` change. Handles pointer input for the active tool:
  - select: hit test → select / drag-move / resize; miss → falls through to text selection (PageSlot keeps its handlers for that);
  - markup: drag previews via `select()` rects, pointer-up → `addAnnot`;
  - draw: SVG preview of the stroke/shape, pointer-up → `addAnnot`;
  - comment: click → `addAnnot(note)` then select it with the card focused;
  - sign: ghost preview, click → `placeSignature`.
  - Renders frames, preview SVG and the **AnnotCard** (comment card) for the selected annotation.
- **`src/app/ToolRail.tsx`**, **`src/app/ToolOptionsBar.tsx`**, **`src/app/CommentsPanel.tsx`**, **`src/app/AuthorDialog.tsx`**.
- **`src/sign/`**: `signature-image.ts` (pure pixel ops: trim to ink, whiten→transparent, over RGBA arrays), `render-signature.ts` (canvas: drawn strokes / typed text → PNG; waits for `document.fonts.load` so Sinhala/Tamil fonts are ready), `SignatureDialog.tsx`, `signatures.ts` (load/save/limit in localStorage).
- `useShortcuts`: Delete/Backspace deletes the selected annotation; Esc → Select tool and clear selection.

## 5. Data flow examples

- **Highlight:** user drags on page 2 with Highlight → layer calls `engine.select` during the drag to show rects → pointer-up → `annot-actions.addAnnot(tab, 2, { kind: "highlight", from, to, color })` → worker `op("Highlight")`: stext quads → `createAnnotation("Highlight")`, quads, colour, author, dates, `update()` → returns id + history → `applyHistory` bumps revision → page re-renders with the highlight; Comments panel reloads.
- **Comment on highlight:** Select tool, click the highlight → card opens → type Sinhala → blur → `updateAnnotation(contents)` → one undo step.
- **Sign:** Sign tool, pick signature → click at (x, y) → `placeSignature` builds `rect = fitSignature([x, y], 150, aspect)` → `addAnnotation({ kind: "stamp", rect, png })` → tool back to Select, stamp selected.

## 6. Error handling

- Markup drag over no text → no annotation, notice "No text there to highlight".
- Worker errors → existing `runEdit` path: "Edit failed" notice, journal operation abandoned, nothing half-applied.
- Unknown annotation id (e.g. stale UI after undo) → error → notice; the layer reloads on the next revision.
- Non-annotatable PDF → notice, tool not changed.
- `localStorage` unavailable/full → signatures and author last for the session only; saving a signature that doesn't fit shows a notice.
- Image signature that is not a decodable PNG/JPEG → notice "Couldn't read that image".

## 7. Testing

- **Worker (Vitest + real MuPDF, node):** `annotations.test.ts` — each kind creates the right subtype/colour/geometry; markup quads over "Hello world" and the Sinhala line of `sample-si-ta.pdf`; markup over blank area → null; Sinhala/Tamil contents + author survive save/reopen; move shifts ink/line/rect/note/stamp and rejects markup; resize stamp/rect; delete; list skips Link/Widget/Popup; rotated page (`/Rotate 90`) keeps page-space geometry; editor undo/redo round-trips add + move + delete.
- **Pure UI logic:** `annot-geometry.test.ts` (hit testing, polyline distance, drag rect, signature fit), `signature-image.test.ts` (trim, whitening), `signatures.test.ts` (limit, bad storage).
- **Store/actions:** tool transitions vs Edit mode, author/signature persistence, `chooseTool` gating order (permission → signed → author), `deleteSelectedAnnot`, `placeSignature` returns to Select with the stamp selected.
- **Components (Testing Library):** ToolRail pressed states and Edit-mode buttons, ToolOptionsBar per tool, CommentsPanel listing/click/empty state, AuthorDialog OK/Skip.
- **Manual (browser preview + built app):** highlight Sinhala/Tamil lines, comment in Sinhala, draw each shape, create a signature each way and place it, undo/redo, save, reopen in Acrobat/Chrome/Preview; Windows build via `build.yml`.

## 8. Delivery

- Branch `feat/annotations` from `main`; plan `docs/superpowers/plans/2026-09-29-annotations.md`; PR → CI (web, macOS, Windows) → merge on owner approval.
- Then E2 per `2026-09-28-editing-design.md`.

## 9. Open questions (for later, not blocking)

- Should Sign also offer initials and a date stamp (Acrobat Fill & Sign has both)?
- Print "document only" vs "document and markups" choice (today: always with markups).
