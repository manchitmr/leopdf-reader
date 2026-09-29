# Annotations & Tool Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Acrobat-style vertical tool rail with Highlight/Underline/Strikethrough, sticky-note Comments, Draw (pen, line, arrow, rectangle, oval) and visual Signatures — all standard PDF annotations with undo/redo and save — plus a Comments panel.

**Architecture:** Worker side: pure MuPDF functions in `src/edit/annotations.ts`, wrapped as journaled operations in `DocumentEditor` (same undo stack as E1) and exposed through `DocumentEngine` / Comlink. Main thread: the store gains rail tools, per-tool styles, an annotation selection, author name and saved signatures; `annot-actions.ts` gates and runs edits via E1's `runEdit`; a per-page `AnnotationLayer` (SVG hit shapes + capture layer) handles input; `ToolRail`, `ToolOptionsBar`, `CommentsPanel`, `AuthorDialog` and `SignatureDialog` are the UI.

**Tech Stack:** mupdf.js 1.28 (WASM), React 19, Zustand 5, Comlink, lucide-react, Vitest 4 (+ Testing Library, jsdom), TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-29-annotations-design.md`

## Global Constraints

- License AGPL-3.0-or-later; no new npm dependencies.
- Every new user-visible string exists in `en`, `si` and `ta` (`src/i18n/strings.test.ts` enforces keys and placeholders).
- Test/sample text is Sri Lankan: ශ්‍රී ලංකාව, කොළඹ, යාපනය, யாழ்ப்பாணம், கொழும்பு. Never "Tamil Nadu"/"தமிழ் நாடு".
- MuPDF `asUint8Array()` views are detached by the next WASM allocation — always `.slice()`.
- Annotation geometry is page space (y down, rotation applied) — the same space as `PageTransform.toPage` and E1.
- Annotation ids are PDF object numbers (`annot.getObject().asIndirect()`), numbers on the main thread; `EditResult.id` carries them as strings.
- Every document change goes through `DocumentEditor.op(...)` (journal) and, on the main thread, through `runEdit` (history, dirty dot, revision bump, notices).
- Signatures and author name live only in this computer's `localStorage` (`leopdf.signatures`, `leopdf.author`); max 5 signatures.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Rotated pages** (`/Rotate 90` files and the Rotate-view button): annotations must land where the pointer was and list back in page space. → Task 1 rotated-page test; the layer only uses `PageTransform.toPage/toDisplay` (already tested).
2. **Undo removes the selected annotation:** the comment card must disappear and Delete must not hit a stale id. → Task 5 test "undo and redo clear the annotation selection".
3. **Clicking away while typing a comment:** React may unmount the card before `blur`; the text must still be saved. → Task 7 AnnotCard test "unmounting with unsaved text saves it".
4. **Long multi-line Sinhala/Tamil comments** (ZWJ, newlines) must be stored exactly. → Task 1 round-trip test uses a two-line comment with ZWJ.
5. **`localStorage` full or unavailable:** signatures still work for the session and the user is told. → Task 3 prefs test (`saveSignatures` returns false) + App subscriber shows `signatureNotSaved`.
6. **Dragging a highlight backwards** (right-to-left or bottom-to-top) must still mark the text. → Task 1 test "reversed drag marks the same text".

---

## File Structure

| File | Responsibility |
|---|---|
| `src/edit/types.ts` (modify) | `RGB`, `AnnotKind`, `Annot`, `NewAnnot`, `AnnotPatch`; `EditResult.empty` |
| `src/edit/annotations.ts` (create) | Pure MuPDF annotation functions: list, add, update, move, resize, delete |
| `src/edit/editor.ts` (modify) | Journaled wrappers returning `EditResult` |
| `src/engine/document-engine.ts`, `engine-api.ts`, `lazy-api.ts`, `types.ts` (modify) | Engine/API surface; `DocInfo.annotatable` |
| `src/platform/prefs.ts` (create) | Author + signatures persistence |
| `src/state/palette.ts` (create) | Colour palettes and colour helpers |
| `src/state/store.ts` (modify) | Rail tool, styles, annotation selection, author, signatures, dialogs |
| `src/viewer/annot-geometry.ts` (create) | Pure geometry for the annotation layer |
| `src/i18n/strings.ts` (modify) | New strings en/si/ta |
| `src/app/annot-actions.ts` (create) | Tool gating and annotation edits |
| `src/app/edit-actions.ts` (modify) | `enterEditMode(tool)`, signed dialog `then`, undo/redo clear selection |
| `src/app/ToolRail.tsx`, `ToolOptionsBar.tsx`, `Swatches.tsx`, `AuthorDialog.tsx` (create) | Rail and options UI |
| `src/app/Toolbar.tsx`, `App.tsx`, `ConfirmDialog.tsx`, `app.css` (modify) | Layout and wiring |
| `src/app/annot-labels.ts` (create) | Kind → label/icon |
| `src/viewer/AnnotationLayer.tsx`, `AnnotCard.tsx` (create); `PageSlot.tsx` (modify) | Per-page annotation input and comment card |
| `src/app/useShortcuts.ts` (modify) | Delete / Esc for annotations |
| `src/app/CommentsPanel.tsx` (create); `LeftPanel.tsx` (modify) | Comments panel |
| `src/sign/signature-image.ts` (create) | Pure pixel ops |
| `src/sign/render-signature.ts`, `src/sign/SignatureDialog.tsx` (create) | Canvas rendering and dialog |

---

### Task 1: Annotation core (worker, pure MuPDF)

**Files:**
- Modify: `src/edit/types.ts`
- Create: `src/edit/annotations.ts`
- Test: `src/edit/annotations.test.ts`

**Interfaces:**
- Produces (types, `src/edit/types.ts`):
  ```ts
  export type RGB = [number, number, number];
  export type AnnotKind = "highlight" | "underline" | "strikeout" | "ink" | "line" | "arrow" | "rect" | "oval" | "note" | "stamp" | "other";
  export interface Annot { id: number; page: number; kind: AnnotKind; subtype: string; rect: Rect; box: Rect | null; quads?: Quad[]; strokes?: Point[][]; color: RGB | null; contents: string; author: string; modified: number | null; movable: boolean; resizable: boolean }
  export type NewAnnot = ... (see Step 1)
  export interface AnnotPatch { contents?: string; color?: RGB }
  EditResult gains: empty?: boolean
  ```
- Produces (`src/edit/annotations.ts`): `listAnnotations(page: mupdf.PDFPage, pageIndex: number): Annot[]`, `addAnnotation(page, spec: NewAnnot, author: string, now?: Date): number`, `updateAnnotation(page, id: number, patch: AnnotPatch, now?: Date): void`, `moveAnnotation(page, id, dx, dy, now?)`, `resizeAnnotation(page, id, rect: Rect, now?)`, `deleteAnnotation(page, id)`, `class NoTextError`, `SIGNATURE_ICON`, `NOTE_SIZE`.

- [ ] **Step 1: Add the types**

Append to `src/edit/types.ts` (and add `Quad` to its `../engine/types` import):

```ts
export type RGB = [number, number, number];

export type AnnotKind = "highlight" | "underline" | "strikeout" | "ink" | "line" | "arrow" | "rect" | "oval" | "note" | "stamp" | "other";

/** A PDF annotation as the UI sees it. Geometry is page space. */
export interface Annot {
  /** PDF object number — stable across undo/redo. */
  id: number;
  page: number;
  kind: AnnotKind;
  /** PDF /Subtype, e.g. "FreeText" for kind "other". */
  subtype: string;
  /** Visual bounds (includes the border); used for display and hit shapes. */
  rect: Rect;
  /** The stored /Rect for types that have one; move/resize use this. */
  box: Rect | null;
  quads?: Quad[];
  /** Ink strokes; for line/arrow one two-point stroke. */
  strokes?: Point[][];
  color: RGB | null;
  contents: string;
  author: string;
  /** Last modified, ms since epoch. */
  modified: number | null;
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

export interface AnnotPatch {
  contents?: string;
  color?: RGB;
}
```

And in `EditResult` add:

```ts
  /** The edit changed nothing (e.g. a highlight dragged over no text). */
  empty?: boolean;
```

- [ ] **Step 2: Write the failing tests**

Create `src/edit/annotations.test.ts`:

```ts
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import type { Point } from "../engine/types";
import {
  NoTextError, SIGNATURE_ICON, addAnnotation, deleteAnnotation, listAnnotations, moveAnnotation, resizeAnnotation, updateAnnotation,
} from "./annotations";
import type { RGB } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const FIXTURE = readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url));
const RED: RGB = [1, 0, 0];
const YELLOW: RGB = [1, 1, 0];

let pdf: mupdf.PDFDocument;
let page: mupdf.PDFPage;
beforeEach(() => {
  pdf = new mupdf.PDFDocument(FIXTURE);
  page = pdf.loadPage(0);
});

/** Left and right middle points of the first text line whose text matches `pattern`. */
function lineEnds(pattern: RegExp): [Point, Point] {
  const st = page.toStructuredText("preserve-whitespace");
  const json = JSON.parse(st.asJSON()) as { blocks: { lines?: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] }[] };
  st.destroy();
  const line = json.blocks.flatMap((b) => b.lines ?? []).find((l) => pattern.test(l.text));
  if (!line) throw new Error(`no line matching ${pattern}`);
  const { x, y, w, h } = line.bbox;
  return [[x + 1, y + h / 2], [x + w - 1, y + h / 2]];
}

function reopen(): mupdf.PDFPage {
  return new mupdf.PDFDocument(pdf.saveToBuffer("").asUint8Array().slice()).loadPage(0);
}

/** 100×40 transparent PNG with an opaque blue bar across the middle. */
function signaturePng(): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 100, 40], true);
  pix.clear();
  const px = pix.getPixels();
  for (let y = 16; y < 24; y++) for (let x = 5; x < 95; x++) px.set([0, 0, 200, 255], (y * 100 + x) * 4);
  return pix.asPNG().slice();
}

function pixel(p: mupdf.PDFPage, x: number, y: number): number[] {
  const pix = p.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const i = y * pix.getStride() + x * 3;
  const rgb = Array.from(pix.getPixels().slice(i, i + 3));
  pix.destroy();
  return rgb;
}

test("the fixture starts without annotations", () => {
  expect(listAnnotations(page, 0)).toEqual([]);
});

test.each([
  ["English", /Hello/],
  ["Sinhala", /[඀-෿]/],
  ["Tamil", /[஀-௿]/],
])("highlight follows the text of a %s line", (_name, pattern) => {
  const [from, to] = lineEnds(pattern);
  const id = addAnnotation(page, { kind: "highlight", from, to, color: YELLOW }, "Leo");
  const [annot] = listAnnotations(page, 0);
  expect(annot).toMatchObject({ id, kind: "highlight", subtype: "Highlight", color: YELLOW, author: "Leo", movable: false, resizable: false, box: null });
  expect(annot.quads!.length).toBeGreaterThan(0);
  for (const q of annot.quads!) {
    expect(q[1]).toBeLessThan(from[1]); // top edge above the line's middle
    expect(q[5]).toBeGreaterThan(from[1]); // bottom edge below it
  }
});

test("a reversed drag marks the same text", () => {
  const [from, to] = lineEnds(/Hello/);
  addAnnotation(page, { kind: "underline", from: to, to: from, color: RED }, "");
  const [annot] = listAnnotations(page, 0);
  expect(annot.kind).toBe("underline");
  expect(annot.quads!.length).toBeGreaterThan(0);
});

test("a markup drag over empty space throws NoTextError and adds nothing", () => {
  expect(() => addAnnotation(page, { kind: "strikeout", from: [300, 700], to: [500, 700], color: RED }, "")).toThrow(NoTextError);
  expect(listAnnotations(page, 0)).toEqual([]);
});

test("ink, line, arrow, rectangle and oval keep their geometry and colour", () => {
  addAnnotation(page, { kind: "ink", strokes: [[[100, 300], [150, 320], [200, 300]]], color: RED, width: 3 }, "");
  addAnnotation(page, { kind: "line", from: [50, 600], to: [250, 650], color: RED, width: 2 }, "");
  addAnnotation(page, { kind: "arrow", from: [50, 700], to: [250, 700], color: RED, width: 2 }, "");
  addAnnotation(page, { kind: "rect", rect: [300, 400, 400, 450], color: RED, width: 2 }, "");
  addAnnotation(page, { kind: "oval", rect: [420, 400, 520, 450], color: RED, width: 2 }, "");
  const list = listAnnotations(page, 0);
  expect(list.map((a) => a.kind)).toEqual(["ink", "line", "arrow", "rect", "oval"]);
  expect(list.every((a) => a.color?.join() === RED.join())).toBe(true);
  expect(list[0].strokes).toEqual([[[100, 300], [150, 320], [200, 300]]]);
  expect(list[1].strokes).toEqual([[[50, 600], [250, 650]]]);
  expect(list[3]).toMatchObject({ box: [300, 400, 400, 450], movable: true, resizable: true });
  expect(list[4]).toMatchObject({ box: [420, 400, 520, 450], resizable: true });
});

test("notes keep multi-line Sinhala/Tamil comments and the author after save", () => {
  const comment = "ශ්‍රී ලංකාව — කොළඹ\nயாழ்ப்பாணம் கொழும்பு";
  addAnnotation(page, { kind: "note", at: [300, 300], contents: comment }, "මනිත්");
  const [annot] = listAnnotations(reopen(), 0);
  expect(annot).toMatchObject({ kind: "note", contents: comment, author: "මනිත්", box: [290, 290, 310, 310], movable: true, resizable: false });
  expect(annot.modified).toBeGreaterThan(0);
});

test("updateAnnotation changes the comment and colour of a highlight", () => {
  const [from, to] = lineEnds(/Hello/);
  const id = addAnnotation(page, { kind: "highlight", from, to, color: YELLOW }, "");
  updateAnnotation(page, id, { contents: "යාපනය", color: [0, 1, 0] });
  const [annot] = listAnnotations(reopen(), 0);
  expect(annot).toMatchObject({ contents: "යාපනය", color: [0, 1, 0] });
});

test("move shifts ink, lines, boxes, notes and stamps; markup cannot move", () => {
  const ink = addAnnotation(page, { kind: "ink", strokes: [[[100, 300], [200, 300]]], color: RED, width: 2 }, "");
  const line = addAnnotation(page, { kind: "arrow", from: [50, 600], to: [250, 650], color: RED, width: 2 }, "");
  const box = addAnnotation(page, { kind: "rect", rect: [300, 400, 400, 450], color: RED, width: 2 }, "");
  const note = addAnnotation(page, { kind: "note", at: [300, 300], contents: "" }, "");
  const stamp = addAnnotation(page, { kind: "stamp", rect: [100, 500, 200, 540], png: signaturePng() }, "");
  for (const id of [ink, line, box, note, stamp]) moveAnnotation(page, id, 10, -5);
  const byId = new Map(listAnnotations(page, 0).map((a) => [a.id, a]));
  expect(byId.get(ink)!.strokes).toEqual([[[110, 295], [210, 295]]]);
  expect(byId.get(line)!.strokes).toEqual([[[60, 595], [260, 645]]]);
  expect(byId.get(box)!.box).toEqual([310, 395, 410, 445]);
  expect(byId.get(note)!.box).toEqual([300, 285, 320, 305]);
  expect(byId.get(stamp)!.box).toEqual([110, 495, 210, 535]);
  const [from, to] = lineEnds(/Hello/);
  const mark = addAnnotation(page, { kind: "highlight", from, to, color: YELLOW }, "");
  expect(() => moveAnnotation(page, mark, 1, 1)).toThrow("cannot be moved");
});

test("resize changes rectangles and stamps; notes are not resizable", () => {
  const box = addAnnotation(page, { kind: "oval", rect: [300, 400, 400, 450], color: RED, width: 2 }, "");
  const stamp = addAnnotation(page, { kind: "stamp", rect: [100, 500, 200, 540], png: signaturePng() }, "");
  const note = addAnnotation(page, { kind: "note", at: [300, 300], contents: "" }, "");
  resizeAnnotation(page, box, [300, 400, 450, 480]);
  resizeAnnotation(page, stamp, [100, 500, 300, 580]);
  const byId = new Map(listAnnotations(page, 0).map((a) => [a.id, a]));
  expect(byId.get(box)!.box).toEqual([300, 400, 450, 480]);
  expect(byId.get(stamp)!.box).toEqual([100, 500, 300, 580]);
  expect(() => resizeAnnotation(page, note, [0, 0, 50, 50])).toThrow("cannot be resized");
});

test("signature stamps keep transparency, survive edits and carry LeoPDF's name", () => {
  const id = addAnnotation(page, { kind: "stamp", rect: [300, 500, 400, 540], png: signaturePng() }, "Leo");
  const check = (p: mupdf.PDFPage) => {
    const [r, g, b] = pixel(p, 310, 505); // transparent corner: page stays white
    expect(Math.min(r, g, b)).toBeGreaterThan(240);
    const [br, , bb] = pixel(p, 350, 520); // the blue bar
    expect(bb).toBeGreaterThan(120);
    expect(br).toBeLessThan(80);
  };
  check(page);
  updateAnnotation(page, id, { contents: "signed" });
  resizeAnnotation(page, id, [300, 500, 400, 540]);
  check(page);
  check(reopen());
  expect(page.getAnnotations()[0].getIcon()).toBe(SIGNATURE_ICON);
  expect(listAnnotations(page, 0)[0]).toMatchObject({ kind: "stamp", resizable: true });
});

test("listing skips links and reports page-space geometry on rotated pages", () => {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 300, 500], 90, doc.newDictionary(), ""));
  const rotated = doc.loadPage(0);
  rotated.createLink([10, 10, 50, 50], "https://example.com");
  const id = addAnnotation(rotated, { kind: "rect", rect: [10, 60, 60, 90], color: RED, width: 2 }, "");
  const list = listAnnotations(rotated, 0);
  expect(list.map((a) => a.id)).toEqual([id]);
  expect(list[0].box).toEqual([10, 60, 60, 90]);
});

test("delete removes an annotation; unknown ids throw", () => {
  const id = addAnnotation(page, { kind: "note", at: [300, 300], contents: "x" }, "");
  deleteAnnotation(page, id);
  expect(listAnnotations(page, 0)).toEqual([]);
  expect(() => deleteAnnotation(page, id)).toThrow(`Unknown annotation ${id}`);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/edit/annotations.test.ts`
Expected: FAIL — cannot resolve `./annotations`.

- [ ] **Step 4: Implement `src/edit/annotations.ts`**

```ts
import * as mupdf from "mupdf";
import type { Point, Quad, Rect } from "../engine/types";
import type { Annot, AnnotKind, AnnotPatch, NewAnnot, RGB } from "./types";

/** Annotation types that are not comments or markups. */
const HIDDEN = new Set(["Link", "Widget", "Popup"]);
const KINDS: Record<string, AnnotKind> = {
  Highlight: "highlight", Underline: "underline", StrikeOut: "strikeout", Ink: "ink", Square: "rect", Circle: "oval", Text: "note", Stamp: "stamp",
};
const MARKUP_SUBTYPE = { highlight: "Highlight", underline: "Underline", strikeout: "StrikeOut" } as const;
const SHAPE_SUBTYPE = { rect: "Square", oval: "Circle" } as const;

export const NOTE_SIZE = 20;
const NOTE_COLOR: RGB = [1, 0.84, 0];
/** /Name of signature stamps placed by LeoPDF. */
export const SIGNATURE_ICON = "LeoPDFSignature";

/** A markup drag that covers no text. */
export class NoTextError extends Error {
  constructor() {
    super("No text under the drag");
  }
}

const idOf = (a: mupdf.PDFAnnotation) => a.getObject().asIndirect();

function kindOf(a: mupdf.PDFAnnotation): AnnotKind {
  const subtype = a.getType();
  if (subtype === "Line") {
    const { start, end } = a.getLineEndingStyles();
    return start === "None" && end === "None" ? "line" : "arrow";
  }
  return KINDS[subtype] ?? "other";
}

function colorOf(a: mupdf.PDFAnnotation): RGB | null {
  const c = a.getColor();
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 4) return [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  return null;
}

function modifiedOf(a: mupdf.PDFAnnotation): number | null {
  try {
    const t = a.getModificationDate().getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

function describe(a: mupdf.PDFAnnotation, page: number): Annot {
  const kind = kindOf(a);
  const quads = a.hasQuadPoints() ? (a.getQuadPoints() as Quad[]) : undefined;
  const strokes = a.hasInkList() ? (a.getInkList() as Point[][]) : a.hasLine() ? [a.getLine() as Point[]] : undefined;
  const box = a.hasRect() ? (a.getRect() as Rect) : null;
  return {
    id: idOf(a),
    page,
    kind,
    subtype: a.getType(),
    rect: a.getBounds() as Rect,
    box,
    ...(quads ? { quads } : {}),
    ...(strokes ? { strokes } : {}),
    color: colorOf(a),
    contents: a.getContents() ?? "",
    author: a.hasAuthor() ? a.getAuthor() : "",
    modified: modifiedOf(a),
    movable: !quads && (strokes !== undefined || a.hasVertices() || box !== null),
    resizable: kind === "rect" || kind === "oval" || kind === "stamp",
  };
}

export function listAnnotations(page: mupdf.PDFPage, pageIndex: number): Annot[] {
  return page.getAnnotations().filter((a) => !HIDDEN.has(a.getType())).map((a) => describe(a, pageIndex));
}

function find(page: mupdf.PDFPage, id: number): mupdf.PDFAnnotation {
  const annot = page.getAnnotations().find((a) => idOf(a) === id);
  if (!annot) throw new Error(`Unknown annotation ${id}`);
  return annot;
}

function textQuads(page: mupdf.PDFPage, from: Point, to: Point): Quad[] {
  const st = page.toStructuredText("preserve-whitespace");
  try {
    return st.highlight(from, to) as Quad[];
  } finally {
    st.destroy();
  }
}

function touch(a: mupdf.PDFAnnotation, now: Date): void {
  a.setModificationDate(now);
  a.update();
}

/** Creates the annotation and returns its id. Throws NoTextError for a markup drag over no text. */
export function addAnnotation(page: mupdf.PDFPage, spec: NewAnnot, author: string, now = new Date()): number {
  let a: mupdf.PDFAnnotation;
  switch (spec.kind) {
    case "highlight":
    case "underline":
    case "strikeout": {
      const quads = textQuads(page, spec.from, spec.to);
      if (quads.length === 0) throw new NoTextError();
      a = page.createAnnotation(MARKUP_SUBTYPE[spec.kind]);
      a.setQuadPoints(quads);
      a.setColor(spec.color);
      break;
    }
    case "ink":
      a = page.createAnnotation("Ink");
      a.setInkList(spec.strokes);
      a.setColor(spec.color);
      a.setBorderWidth(spec.width);
      break;
    case "line":
    case "arrow":
      a = page.createAnnotation("Line");
      a.setLine(spec.from, spec.to);
      a.setLineEndingStyles("None", spec.kind === "arrow" ? "OpenArrow" : "None");
      a.setColor(spec.color);
      a.setBorderWidth(spec.width);
      break;
    case "rect":
    case "oval":
      a = page.createAnnotation(SHAPE_SUBTYPE[spec.kind]);
      a.setRect(spec.rect);
      a.setColor(spec.color);
      a.setBorderWidth(spec.width);
      break;
    case "note": {
      const [x, y] = spec.at;
      const h = NOTE_SIZE / 2;
      a = page.createAnnotation("Text");
      a.setRect([x - h, y - h, x + h, y + h]);
      a.setIcon("Comment");
      a.setColor(NOTE_COLOR);
      a.setContents(spec.contents);
      break;
    }
    case "stamp":
      a = page.createAnnotation("Stamp");
      a.setRect(spec.rect);
      // Name first: setStampImage then replaces the icon's appearance with the image.
      a.setIcon(SIGNATURE_ICON);
      a.setStampImage(new mupdf.Image(spec.png));
      break;
  }
  if (author) a.setAuthor(author);
  a.setCreationDate(now);
  touch(a, now);
  return idOf(a);
}

export function updateAnnotation(page: mupdf.PDFPage, id: number, patch: AnnotPatch, now = new Date()): void {
  const a = find(page, id);
  if (patch.contents !== undefined) a.setContents(patch.contents);
  if (patch.color) a.setColor(patch.color);
  touch(a, now);
}

export function moveAnnotation(page: mupdf.PDFPage, id: number, dx: number, dy: number, now = new Date()): void {
  const a = find(page, id);
  const shift = ([x, y]: Point): Point => [x + dx, y + dy];
  if (a.hasQuadPoints()) throw new Error("Text markup cannot be moved");
  if (a.hasInkList()) a.setInkList((a.getInkList() as Point[][]).map((s) => s.map(shift)));
  else if (a.hasLine()) {
    const [p, q] = a.getLine() as Point[];
    a.setLine(shift(p), shift(q));
  } else if (a.hasVertices()) a.setVertices((a.getVertices() as Point[]).map(shift));
  else if (a.hasRect()) {
    const [x0, y0, x1, y1] = a.getRect();
    a.setRect([x0 + dx, y0 + dy, x1 + dx, y1 + dy]);
  } else throw new Error(`${a.getType()} annotations cannot be moved`);
  touch(a, now);
}

export function resizeAnnotation(page: mupdf.PDFPage, id: number, rect: Rect, now = new Date()): void {
  const a = find(page, id);
  if (!describe(a, 0).resizable) throw new Error(`${a.getType()} annotations cannot be resized`);
  a.setRect(rect);
  touch(a, now);
}

export function deleteAnnotation(page: mupdf.PDFPage, id: number): void {
  page.deleteAnnotation(find(page, id));
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/edit/annotations.test.ts`
Expected: PASS. If the signature test fails because `setIcon` before `setStampImage` loses the image, remove the `setIcon` line and instead, after `setStampImage`, write the name straight into the dictionary (no appearance regeneration): `a.getObject().put("Name", page._doc.newName(SIGNATURE_ICON));`. Re-run; record the ruling in the ledger.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` — Expected: no errors.

```bash
git add src/edit/types.ts src/edit/annotations.ts src/edit/annotations.test.ts
git commit -m "feat(edit): annotation core — markup, ink, shapes, notes and signature stamps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Journaled annotation edits through the editor and engine

**Files:**
- Modify: `src/edit/editor.ts`, `src/engine/document-engine.ts`, `src/engine/engine-api.ts`, `src/engine/lazy-api.ts`, `src/engine/types.ts`
- Modify (fixtures: add `annotatable: true` next to `signed: false`): `src/app/LeftPanel.test.tsx`, `src/app/open-document.test.ts`, `src/app/EditBar.test.tsx`, `src/app/edit-actions.test.ts`, `src/app/SearchBar.test.tsx`, `src/app/print.test.ts`, `src/state/store.test.ts`
- Test: `src/edit/editor.test.ts`, `src/engine/document-engine.test.ts`

**Interfaces:**
- Consumes: Task 1 functions and types.
- Produces:
  - `DocumentEditor`: `listAnnotations(page): Annot[]`, `addAnnotation(page, spec: NewAnnot, author: string): Promise<EditResult>` (`empty: true` for markup over no text), `updateAnnotation(page, id: number, patch: AnnotPatch)`, `moveAnnotation(page, id, dx, dy)`, `resizeAnnotation(page, id, rect)`, `deleteAnnotation(page, id)` — all `Promise<EditResult>`, `id` = `String(objectNumber)`.
  - `DocumentEngine` / `EngineApi`: `addAnnotation(docId, page, spec, author)`, `updateAnnotation(docId, page, id, patch)`, `moveAnnotation(docId, page, id, dx, dy)`, `resizeAnnotation(docId, page, id, rect)`, `deleteAnnotation(docId, page, id)`, `listAnnotations(docId, page?): Annot[]`.
  - `DocInfo.annotatable: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/edit/editor.test.ts`:

```ts
test("annotations share the journal: add, move, undo, delete, undo", async () => {
  const r = await editor.addAnnotation(0, { kind: "rect", rect: [100, 500, 200, 560], color: [1, 0, 0], width: 2 }, "Leo");
  const id = Number(r.id);
  expect(r.history).toEqual({ canUndo: true, canRedo: false, dirty: true });
  await editor.moveAnnotation(0, id, 10, 0);
  expect(editor.listAnnotations(0)[0].box).toEqual([110, 500, 210, 560]);
  editor.undo();
  expect(editor.listAnnotations(0)[0].box).toEqual([100, 500, 200, 560]);
  await editor.deleteAnnotation(0, id);
  expect(editor.listAnnotations(0)).toEqual([]);
  editor.undo();
  expect(editor.listAnnotations(0)).toHaveLength(1);
  const saved = new mupdf.PDFDocument(editor.save()).loadPage(0).getAnnotations();
  expect(saved.map((a) => a.getType())).toEqual(["Square"]);
});

test("a highlight over no text changes nothing and says so", async () => {
  const r = await editor.addAnnotation(0, { kind: "highlight", from: [300, 700], to: [500, 700], color: [1, 1, 0] }, "");
  expect(r).toEqual({ history: { canUndo: false, canRedo: false, dirty: false }, empty: true });
});

test("comment text and colour changes are single undo steps", async () => {
  const { id } = await editor.addAnnotation(0, { kind: "note", at: [300, 300], contents: "" }, "");
  await editor.updateAnnotation(0, Number(id), { contents: "කොළඹ" });
  expect(editor.listAnnotations(0)[0].contents).toBe("කොළඹ");
  editor.undo();
  expect(editor.listAnnotations(0)[0].contents).toBe("");
});
```

Append to `src/engine/document-engine.test.ts`:

```ts
test("annotations are added, listed per page and for the whole document", async () => {
  const r = engine.open("a", fixture);
  expect(r.status === "ok" && r.info.annotatable).toBe(true);
  expect(engine.listAnnotations("a")).toEqual([]);
  await engine.addAnnotation("a", 1, { kind: "note", at: [100, 100], contents: "யாழ்ப்பாணம்" }, "Leo");
  expect(engine.listAnnotations("a", 0)).toEqual([]);
  expect(engine.listAnnotations("a").map((x) => [x.page, x.kind, x.contents])).toEqual([[1, "note", "யாழ்ப்பாணம்"]]);
  expect(engine.history("a").dirty).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/edit/editor.test.ts src/engine/document-engine.test.ts`
Expected: FAIL — `editor.addAnnotation is not a function` / `engine.listAnnotations is not a function`.

- [ ] **Step 3: Implement the editor wrappers**

In `src/edit/editor.ts` add imports:

```ts
import * as annots from "./annotations";
import type { Annot, AnnotPatch, EditResult, ExistingImage, HistoryState, NewAnnot, PageObject, TextStyle } from "./types";
```

(replace the existing `./types` import line with the one above) and add these methods after `moveExistingImage`:

```ts
  listAnnotations(page: number): Annot[] {
    return annots.listAnnotations(this.pdf.loadPage(page), page);
  }

  async addAnnotation(page: number, spec: NewAnnot, author: string): Promise<EditResult> {
    try {
      const id = this.op("Add annotation", page, (ctx) => annots.addAnnotation(ctx.page, spec, author));
      return this.result(String(id));
    } catch (e) {
      if (e instanceof annots.NoTextError) return { ...this.result(), empty: true };
      throw e;
    }
  }

  async updateAnnotation(page: number, id: number, patch: AnnotPatch): Promise<EditResult> {
    this.op("Edit annotation", page, (ctx) => annots.updateAnnotation(ctx.page, id, patch));
    return this.result(String(id));
  }

  async moveAnnotation(page: number, id: number, dx: number, dy: number): Promise<EditResult> {
    this.op("Move annotation", page, (ctx) => annots.moveAnnotation(ctx.page, id, dx, dy));
    return this.result(String(id));
  }

  async resizeAnnotation(page: number, id: number, rect: Rect): Promise<EditResult> {
    this.op("Resize annotation", page, (ctx) => annots.resizeAnnotation(ctx.page, id, rect));
    return this.result(String(id));
  }

  async deleteAnnotation(page: number, id: number): Promise<EditResult> {
    this.op("Delete annotation", page, (ctx) => annots.deleteAnnotation(ctx.page, id));
    return this.result();
  }
```

- [ ] **Step 4: Engine, API, lazy API and `DocInfo`**

`src/engine/types.ts` — in `DocInfo` after `editable`:

```ts
  /** The PDF allows adding comments and markups. */
  annotatable: boolean;
```

`src/engine/document-engine.ts`:
- import `listAnnotations` from `../edit/annotations` and `Annot, AnnotPatch, NewAnnot` from `../edit/types`;
- in `describe()` after `editable: …`: `annotatable: doc.isPDF() && doc.hasPermission("annotate"),`
- after `moveExistingImage = …` add:

```ts
  addAnnotation = (docId: string, page: number, spec: NewAnnot, author: string) => this.edit(docId, (e) => e.addAnnotation(page, spec, author));
  updateAnnotation = (docId: string, page: number, id: number, patch: AnnotPatch) => this.edit(docId, (e) => e.updateAnnotation(page, id, patch));
  moveAnnotation = (docId: string, page: number, id: number, dx: number, dy: number) => this.edit(docId, (e) => e.moveAnnotation(page, id, dx, dy));
  resizeAnnotation = (docId: string, page: number, id: number, rect: Rect) => this.edit(docId, (e) => e.resizeAnnotation(page, id, rect));
  deleteAnnotation = (docId: string, page: number, id: number) => this.edit(docId, (e) => e.deleteAnnotation(page, id));

  /** Comments and markups on one page, or on every page when `page` is omitted. Does not start the edit journal. */
  listAnnotations(docId: string, page?: number): Annot[] {
    const pdf = this.get(docId).doc.asPDF();
    if (!pdf) return [];
    const pages = page === undefined ? [...Array(pdf.countPages()).keys()] : [page];
    return pages.flatMap((p) => {
      const pg = pdf.loadPage(p);
      try {
        return listAnnotations(pg, p);
      } finally {
        pg.destroy();
      }
    });
  }
```

`src/engine/engine-api.ts` — import `AnnotPatch, NewAnnot` from `../edit/types`; add after `moveExistingImage`:

```ts
    addAnnotation: (docId: string, page: number, spec: NewAnnot, author: string) => engine.addAnnotation(docId, page, spec, author),
    updateAnnotation: (docId: string, page: number, id: number, patch: AnnotPatch) => engine.updateAnnotation(docId, page, id, patch),
    moveAnnotation: (docId: string, page: number, id: number, dx: number, dy: number) => engine.moveAnnotation(docId, page, id, dx, dy),
    resizeAnnotation: (docId: string, page: number, id: number, rect: Rect) => engine.resizeAnnotation(docId, page, id, rect),
    deleteAnnotation: (docId: string, page: number, id: number) => engine.deleteAnnotation(docId, page, id),
    listAnnotations: (docId: string, page?: number) => engine.listAnnotations(docId, page),
```

`src/engine/lazy-api.ts` — extend `METHODS`:

```ts
const METHODS = [
  "open", "unlock", "render", "renderPng", "search", "select", "close",
  "addText", "updateText", "moveObject", "resizeObject", "deleteObject", "addImage", "replaceImage", "deleteImage",
  "moveExistingImage", "listObjects", "listImages", "undo", "redo", "history", "save", "markSaved",
  "addAnnotation", "updateAnnotation", "moveAnnotation", "resizeAnnotation", "deleteAnnotation", "listAnnotations",
] as const satisfies readonly (keyof EngineApi)[];
```

- [ ] **Step 5: Update `DocInfo` fixtures**

Run: `sed -i '' 's/signed: false/signed: false, annotatable: true/' src/app/LeftPanel.test.tsx src/app/open-document.test.ts src/app/EditBar.test.tsx src/app/edit-actions.test.ts src/app/SearchBar.test.tsx src/app/print.test.ts src/state/store.test.ts`
Then: `grep -rn "annotatable: true, annotatable" src` — Expected: no output.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (including `lazy-api.test.ts`, which compares `METHODS` with the API keys), no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(engine): journaled annotation edits and listing through the worker API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store — rail tools, styles, annotation selection, author and signatures

**Files:**
- Create: `src/platform/prefs.ts`, `src/state/palette.ts`
- Modify: `src/state/store.ts`, `src/app/App.tsx` (persistence subscriber only)
- Test: `src/platform/prefs.test.ts`, `src/state/store.test.ts`

**Interfaces:**
- Consumes: `RGB` (Task 1).
- Produces:
  - `prefs.ts`: `SavedSignature { id: string; png: string /* data URL */; width: number; height: number }`, `MAX_SIGNATURES = 5`, `loadAuthor(storage?)`, `saveAuthor(name, storage?)`, `loadSignatures(storage?)`, `saveSignatures(list, storage?): boolean`, `withSignature(list, sig): { list; dropped: boolean }`.
  - `palette.ts`: `MARKUP_COLORS: RGB[]`, `DRAW_COLORS: RGB[]`, `DRAW_WIDTHS = [1, 2, 4, 8]`, `toHex(c: RGB): string`, `sameColor(a, b): boolean`, `cssColor(c: RGB | null, alpha?): string`.
  - `store.ts`: `Tool = "select" | "hand" | "comment" | "markup" | "draw" | "sign"`; `MarkupKind`, `DrawShape`, `MarkupStyle { kind; colors: Record<MarkupKind, RGB> }`, `DrawStyle { shape; color: RGB; width: number }`, `SelectedAnnot { tabId; page; id: number }`; `LeftPanel` adds `"comments"`; `DialogState` = unsaved | `{ kind: "signed"; tabId; then: { edit: EditTool } | { tool: Tool } }` | `{ kind: "author"; then: Tool }` | `{ kind: "signature" }`; state `markupStyle`, `drawStyle`, `signatureId`, `selectedAnnot`, `focusComment`, `author: string | null`, `signatures: SavedSignature[]`; actions `setMarkupStyle({ kind?, color? })`, `setDrawStyle(partial)`, `setSignatureId(id | null)`, `selectAnnot(sel | null, focus?: boolean)`, `setAuthor(name)`, `addSignature(sig): boolean` (true = oldest dropped), `removeSignature(id)`. `setTool` leaves Edit mode for every tool except `"hand"` and clears `selectedAnnot`; `setEditMode(true)` sets `tool: "select"` and clears `selectedAnnot`.

- [ ] **Step 1: Write the failing tests**

Create `src/platform/prefs.test.ts`:

```ts
import { expect, test } from "vitest";
import { MAX_SIGNATURES, loadAuthor, loadSignatures, saveAuthor, saveSignatures, withSignature, type SavedSignature } from "./prefs";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}
const sig = (id: string): SavedSignature => ({ id, png: "data:image/png;base64,AA==", width: 100, height: 40 });

test("author is null until saved, then remembered (empty means 'skipped')", () => {
  const s = memory();
  expect(loadAuthor(s)).toBeNull();
  saveAuthor("", s);
  expect(loadAuthor(s)).toBe("");
  saveAuthor("මනිත්", s);
  expect(loadAuthor(s)).toBe("මනිත්");
});

test("signatures round-trip and bad data is ignored", () => {
  const s = memory();
  expect(saveSignatures([sig("a")], s)).toBe(true);
  expect(loadSignatures(s)).toEqual([sig("a")]);
  s.setItem("leopdf.signatures", "{not json");
  expect(loadSignatures(s)).toEqual([]);
  s.setItem("leopdf.signatures", JSON.stringify([{ id: 1 }, sig("b")]));
  expect(loadSignatures(s)).toEqual([sig("b")]);
});

test("a full or missing storage reports failure instead of throwing", () => {
  const full = { ...memory(), setItem: () => { throw new Error("QuotaExceededError"); } } as Storage;
  expect(saveSignatures([sig("a")], full)).toBe(false);
  expect(() => saveAuthor("x", full)).not.toThrow();
});

test("new signatures go first and the oldest is dropped past the limit", () => {
  let list: SavedSignature[] = [];
  for (let i = 0; i < MAX_SIGNATURES; i++) list = withSignature(list, sig(String(i))).list;
  const r = withSignature(list, sig("new"));
  expect(r.dropped).toBe(true);
  expect(r.list.map((x) => x.id)).toEqual(["new", "4", "3", "2", "1"]);
});
```

Append to `src/state/store.test.ts`:

```ts
test("annotation tools leave edit mode; entering edit mode goes back to Select", () => {
  const { store, id } = storeWithDoc();
  store.getState().setEditMode(true);
  store.getState().setTool("hand");
  expect(store.getState().editMode).toBe(true);
  store.getState().selectAnnot({ tabId: id, page: 0, id: 12 });
  store.getState().setTool("draw");
  expect(store.getState()).toMatchObject({ tool: "draw", editMode: false, selectedAnnot: null });
  store.getState().setEditMode(true);
  expect(store.getState()).toMatchObject({ tool: "select", editMode: true });
});

test("markup colours are remembered per kind; draw style merges", () => {
  const { store } = storeWithDoc();
  store.getState().setMarkupStyle({ color: [0, 1, 0] });
  store.getState().setMarkupStyle({ kind: "underline" });
  expect(store.getState().markupStyle.colors.highlight).toEqual([0, 1, 0]);
  expect(store.getState().markupStyle.kind).toBe("underline");
  store.getState().setDrawStyle({ shape: "arrow", width: 4 });
  expect(store.getState().drawStyle).toMatchObject({ shape: "arrow", width: 4 });
});

test("selecting an annotation can ask for the comment box to be focused", () => {
  const { store, id } = storeWithDoc();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 7 }, true);
  expect(store.getState()).toMatchObject({ selectedAnnot: { id: 7 }, focusComment: true });
  store.getState().selectAnnot(null);
  expect(store.getState().focusComment).toBe(false);
});

test("signatures: newest first and chosen; removing the chosen one clears the choice", () => {
  const { store } = storeWithDoc();
  const sig = (id: string) => ({ id, png: "data:image/png;base64,AA==", width: 10, height: 4 });
  expect(store.getState().addSignature(sig("a"))).toBe(false);
  store.getState().addSignature(sig("b"));
  expect(store.getState().signatures.map((s) => s.id)).toEqual(["b", "a"]);
  expect(store.getState().signatureId).toBe("b");
  store.getState().removeSignature("b");
  expect(store.getState().signatureId).toBeNull();
});

test("closing a tab clears its annotation selection", () => {
  const { store, id } = storeWithDoc();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 3 });
  store.getState().closeTab(id);
  expect(store.getState().selectedAnnot).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/platform/prefs.test.ts src/state/store.test.ts`
Expected: FAIL — missing module `./prefs`; `setTool("draw")` type error / `selectAnnot is not a function`.

- [ ] **Step 3: Implement `src/platform/prefs.ts`**

```ts
export interface SavedSignature {
  id: string;
  /** PNG as a data URL. */
  png: string;
  width: number;
  height: number;
}

const AUTHOR_KEY = "leopdf.author";
const SIGNATURES_KEY = "leopdf.signatures";
export const MAX_SIGNATURES = 5;

/** null = never asked; "" = the user skipped giving a name. */
export function loadAuthor(storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(AUTHOR_KEY);
  } catch {
    return null;
  }
}

export function saveAuthor(name: string, storage: Storage = localStorage): void {
  try {
    storage.setItem(AUTHOR_KEY, name);
  } catch {
    // Storage unavailable: the name lasts for this session.
  }
}

const isSignature = (v: unknown): v is SavedSignature =>
  typeof v === "object" && v !== null && typeof (v as SavedSignature).id === "string" && typeof (v as SavedSignature).png === "string" &&
  typeof (v as SavedSignature).width === "number" && typeof (v as SavedSignature).height === "number";

export function loadSignatures(storage: Storage = localStorage): SavedSignature[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(SIGNATURES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isSignature) : [];
  } catch {
    return [];
  }
}

/** Returns false when the list could not be stored (full or unavailable storage). */
export function saveSignatures(list: SavedSignature[], storage: Storage = localStorage): boolean {
  try {
    storage.setItem(SIGNATURES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function withSignature(list: SavedSignature[], sig: SavedSignature): { list: SavedSignature[]; dropped: boolean } {
  const next = [sig, ...list.filter((s) => s.id !== sig.id)];
  return { list: next.slice(0, MAX_SIGNATURES), dropped: next.length > MAX_SIGNATURES };
}
```

- [ ] **Step 4: Implement `src/state/palette.ts`**

```ts
import type { RGB } from "../edit/types";

/** Yellow, green, blue, pink, red. */
export const MARKUP_COLORS: RGB[] = [[1, 0.92, 0.23], [0.49, 0.87, 0.35], [0.35, 0.72, 1], [1, 0.55, 0.8], [0.94, 0.27, 0.27]];
/** Red, blue, black, green, orange. */
export const DRAW_COLORS: RGB[] = [[0.86, 0.15, 0.15], [0.15, 0.39, 0.92], [0, 0, 0], [0.09, 0.64, 0.29], [0.98, 0.45, 0.09]];
export const DRAW_WIDTHS = [1, 2, 4, 8];

export const toHex = (c: RGB) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
export const sameColor = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
export const cssColor = (c: RGB | null, alpha = 1) =>
  c ? `rgba(${c.map((v) => Math.round(v * 255)).join(", ")}, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
```

- [ ] **Step 5: Extend the store**

In `src/state/store.ts`:

1. Imports: `import type { HistoryState, RGB, TextStyle } from "../edit/types";`, `import { loadAuthor, loadSignatures, withSignature, type SavedSignature } from "../platform/prefs";`, `import { MARKUP_COLORS, DRAW_COLORS } from "./palette";`
2. Replace the `Tool`, `LeftPanel` and `DialogState` types:

```ts
export type Tool = "select" | "hand" | "comment" | "markup" | "draw" | "sign";
export type LeftPanel = "thumbnails" | "bookmarks" | "comments" | null;
export type MarkupKind = "highlight" | "underline" | "strikeout";
export type DrawShape = "pen" | "line" | "arrow" | "rect" | "oval";

export interface MarkupStyle {
  kind: MarkupKind;
  /** Remembered per kind (yellow highlight, red underline…). */
  colors: Record<MarkupKind, RGB>;
}

export interface DrawStyle {
  shape: DrawShape;
  color: RGB;
  /** Line width in points. */
  width: number;
}

/** A selected annotation (Select tool). `id` is the PDF object number. */
export interface SelectedAnnot {
  tabId: string;
  page: number;
  id: number;
}

export type DialogState =
  | { kind: "unsaved"; tabIds: string[]; action: "close" | "quit" }
  /** Signed-PDF warning; `then` is what to do after "Continue". */
  | { kind: "signed"; tabId: string; then: { edit: EditTool } | { tool: Tool } }
  | { kind: "author"; then: Tool }
  | { kind: "signature" };
```

(`EditTool` is declared above `DialogState` already; move `export type EditTool = "select" | "text";` above it if needed.)

3. `Settings` gains:

```ts
  /** Author for new annotations; null = never asked, "" = skipped. */
  author: string | null;
  signatures: SavedSignature[];
```

4. `AppState` gains state + actions:

```ts
  markupStyle: MarkupStyle;
  drawStyle: DrawStyle;
  signatureId: string | null;
  selectedAnnot: SelectedAnnot | null;
  /** Focus the comment box of the selected annotation (after placing a note). */
  focusComment: boolean;

  setMarkupStyle(change: { kind?: MarkupKind; color?: RGB }): void;
  setDrawStyle(partial: Partial<DrawStyle>): void;
  setSignatureId(id: string | null): void;
  selectAnnot(selected: SelectedAnnot | null, focus?: boolean): void;
  setAuthor(name: string): void;
  /** Adds (newest first) and chooses it; returns true when the oldest was dropped. */
  addSignature(sig: SavedSignature): boolean;
  removeSignature(id: string): void;
```

5. `defaultSettings()` — inside the `try` load author; return:

```ts
function defaultSettings(): Settings {
  let lang: Lang = "en";
  let theme: Theme = "system";
  try {
    lang = (localStorage.getItem("leopdf.lang") as Lang | null) ?? detectLang(navigator.language);
    theme = (localStorage.getItem("leopdf.theme") as Theme | null) ?? "system";
  } catch {
    // No storage (tests, private mode): use defaults.
  }
  const stored = typeof localStorage !== "undefined";
  return {
    lang,
    theme,
    recent: stored ? loadRecent() : [],
    author: stored ? loadAuthor() : null,
    signatures: stored ? loadSignatures() : [],
  };
}
```

6. Initial state (after `notice: null,`):

```ts
      markupStyle: { kind: "highlight", colors: { highlight: MARKUP_COLORS[0], underline: MARKUP_COLORS[4], strikeout: MARKUP_COLORS[4] } },
      drawStyle: { shape: "pen", color: DRAW_COLORS[0], width: 2 },
      signatureId: null,
      selectedAnnot: null,
      focusComment: false,
```

7. Replace `setTool` and `setEditMode`, extend `closeTab`, add the new actions:

```ts
      setTool: (tool) =>
        set((s) => ({
          tool,
          selectedAnnot: null,
          focusComment: false,
          ...(tool !== "hand" && s.editMode ? { editMode: false, editTool: "select" as const, selected: null, inlineEditor: null } : {}),
        })),
      setEditMode: (editMode) =>
        set(editMode ? { editMode, tool: "select", selectedAnnot: null } : { editMode, editTool: "select", selected: null, inlineEditor: null }),
      setMarkupStyle: ({ kind, color }) =>
        set((s) => {
          const k = kind ?? s.markupStyle.kind;
          return { markupStyle: { kind: k, colors: color ? { ...s.markupStyle.colors, [k]: color } : s.markupStyle.colors } };
        }),
      setDrawStyle: (partial) => set((s) => ({ drawStyle: { ...s.drawStyle, ...partial } })),
      setSignatureId: (signatureId) => set({ signatureId }),
      selectAnnot: (selectedAnnot, focus = false) => set({ selectedAnnot, focusComment: focus && selectedAnnot !== null }),
      setAuthor: (author) => set({ author }),
      addSignature(sig) {
        const { list, dropped } = withSignature(get().signatures, sig);
        set({ signatures: list, signatureId: sig.id });
        return dropped;
      },
      removeSignature: (id) =>
        set((s) => ({ signatures: s.signatures.filter((x) => x.id !== id), signatureId: s.signatureId === id ? null : s.signatureId })),
```

In `closeTab`, change the final `set` to:

```ts
        set((s) => ({ tabs: rest, activeId: nextActive, selectedAnnot: s.selectedAnnot?.tabId === id ? null : s.selectedAnnot }));
```

- [ ] **Step 6: Persist author and signatures**

In `src/app/App.tsx` `usePersistedSettings`, import `saveAuthor, saveSignatures` from `../platform/prefs` and add inside the subscriber (after `saveRecent`):

```ts
        if (s.author !== prev.author && s.author !== null) saveAuthor(s.author);
        if (s.signatures !== prev.signatures && !saveSignatures(s.signatures)) s.showNotice("signatureNotSaved");
```

Add the notice string now (Task 5 adds the rest) — `en`: `signatureNotSaved: "Couldn't store the signature on this computer; it lasts until you close LeoPDF.",` `si`: `signatureNotSaved: "අත්සන මෙම පරිගණකයේ ගබඩා කළ නොහැකි විය; LeoPDF වසන තෙක් පමණක් පවතී.",` `ta`: `signatureNotSaved: "கையொப்பத்தை இந்தக் கணினியில் சேமிக்க முடியவில்லை; LeoPDF ஐ மூடும் வரை மட்டுமே இருக்கும்.",`

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. The widened `DialogState` needs three small fixes to typecheck (Task 5 builds on them):
- `enterEditMode` in `src/app/edit-actions.ts`: `s.setDialog({ kind: "signed", tabId: tab.id, then: { edit: "select" } });`
- `resolveDialog`: right after the `signed` branch add `if (dialog.kind !== "unsaved") return;`
- `src/app/ConfirmDialog.tsx`: after `if (!dialog) return null;` add `if (dialog.kind === "author" || dialog.kind === "signature") return null;`
- `src/app/edit-actions.test.ts`: expected signed dialogs gain `then: { edit: "select" }`.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "feat(state): rail tools, annotation styles and selection, author and saved signatures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Annotation layer geometry (pure)

**Files:**
- Create: `src/viewer/annot-geometry.ts`
- Test: `src/viewer/annot-geometry.test.ts`

**Interfaces:**
- Consumes: `DrawStyle` (Task 3), `NewAnnot` (Task 1), `PageTransform` (`src/viewer/geometry.ts`).
- Produces: `dragRect(a: Point, b: Point): Rect`, `shiftRect(r: Rect, d: Point): Rect`, `quadBox(q: Quad): Rect`, `fitSignature(at: Point, width: number, aspect: number): Rect`, `resizeBox(box: Rect, delta: Point, keepAspect: boolean, min?: number): Rect`, `pathLength(points: Point[]): number`, `drawSpec(style: DrawStyle, points: Point[], minSize: number): NewAnnot | null`, `pointsAttr(points: Point[], t: PageTransform): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "vitest";
import type { DrawStyle } from "../state/store";
import { dragRect, drawSpec, fitSignature, pathLength, pointsAttr, quadBox, resizeBox, shiftRect } from "./annot-geometry";
import { pageTransform } from "./geometry";

const style = (shape: DrawStyle["shape"]): DrawStyle => ({ shape, color: [1, 0, 0], width: 2 });

test("drag rectangles are normalised whichever way the user drags", () => {
  expect(dragRect([50, 80], [10, 20])).toEqual([10, 20, 50, 80]);
  expect(shiftRect([0, 0, 10, 10], [5, -2])).toEqual([5, -2, 15, 8]);
  expect(quadBox([10, 20, 60, 20, 10, 32, 60, 32])).toEqual([10, 20, 60, 32]);
});

test("signatures are centred on the click with their aspect ratio", () => {
  expect(fitSignature([200, 300], 150, 3)).toEqual([125, 275, 275, 325]);
});

test("resize keeps a minimum size and optionally the aspect ratio", () => {
  expect(resizeBox([0, 0, 100, 50], [20, 30], false)).toEqual([0, 0, 120, 80]);
  expect(resizeBox([0, 0, 100, 50], [20, 99], true)).toEqual([0, 0, 120, 60]);
  expect(resizeBox([0, 0, 100, 50], [-200, -200], false)).toEqual([0, 0, 8, 8]);
});

test("pointer paths become annotations only when they are big enough", () => {
  const pen = [[0, 0], [3, 4], [6, 8]] as [number, number][];
  expect(pathLength(pen)).toBe(10);
  expect(drawSpec(style("pen"), pen, 2)).toEqual({ kind: "ink", strokes: [pen], color: [1, 0, 0], width: 2 });
  expect(drawSpec(style("pen"), [[0, 0], [0.5, 0]], 2)).toBeNull();
  expect(drawSpec(style("arrow"), [[0, 0], [5, 5], [30, 40]], 2)).toEqual({ kind: "arrow", from: [0, 0], to: [30, 40], color: [1, 0, 0], width: 2 });
  expect(drawSpec(style("oval"), [[40, 50], [10, 10]], 2)).toEqual({ kind: "oval", rect: [10, 10, 40, 50], color: [1, 0, 0], width: 2 });
  expect(drawSpec(style("rect"), [[0, 0], [40, 1]], 2)).toBeNull();
});

test("points are converted to display space for SVG", () => {
  const t = pageTransform([0, 0, 100, 200], 2, 0);
  expect(pointsAttr([[1, 2], [3, 4]], t)).toBe("2,4 6,8");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/viewer/annot-geometry.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/viewer/annot-geometry.ts`**

```ts
import type { NewAnnot } from "../edit/types";
import type { Point, Quad, Rect } from "../engine/types";
import type { DrawStyle } from "../state/store";
import type { PageTransform } from "./geometry";

export function dragRect([ax, ay]: Point, [bx, by]: Point): Rect {
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export const shiftRect = ([x0, y0, x1, y1]: Rect, [dx, dy]: Point): Rect => [x0 + dx, y0 + dy, x1 + dx, y1 + dy];

export function quadBox(q: Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A `width`-wide box with the image's aspect ratio (width / height), centred on `at`. */
export function fitSignature([x, y]: Point, width: number, aspect: number): Rect {
  const height = width / aspect;
  return [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
}

/** Grows/shrinks from the top-left corner by the drag delta. */
export function resizeBox([x0, y0, x1, y1]: Rect, [dx, dy]: Point, keepAspect: boolean, min = 8): Rect {
  const width = Math.max(min, x1 - x0 + dx);
  const height = keepAspect ? (width * (y1 - y0)) / (x1 - x0) : Math.max(min, y1 - y0 + dy);
  return [x0, y0, x0 + width, y0 + height];
}

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** Turns a pointer path (page space) into a new annotation, or null if it is too small to mean anything. */
export function drawSpec({ shape, color, width }: DrawStyle, points: Point[], minSize: number): NewAnnot | null {
  if (points.length < 2) return null;
  if (shape === "pen") return pathLength(points) >= minSize ? { kind: "ink", strokes: [points], color, width } : null;
  const from = points[0];
  const to = points[points.length - 1];
  if (shape === "line" || shape === "arrow") return Math.hypot(to[0] - from[0], to[1] - from[1]) >= minSize ? { kind: shape, from, to, color, width } : null;
  const rect = dragRect(from, to);
  return rect[2] - rect[0] >= minSize && rect[3] - rect[1] >= minSize ? { kind: shape, rect, color, width } : null;
}

export function pointsAttr(points: Point[], t: PageTransform): string {
  return points.map((p) => t.toDisplay(p).join(",")).join(" ");
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/viewer/annot-geometry.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/annot-geometry.ts src/viewer/annot-geometry.test.ts
git commit -m "feat(viewer): pure geometry for the annotation layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Strings and annotation actions (tool gating, edits, dialogs)

**Files:**
- Modify: `src/i18n/strings.ts`, `src/app/edit-actions.ts`, `src/app/ConfirmDialog.tsx`, `src/app/edit-actions.test.ts`
- Create: `src/app/annot-actions.ts`
- Test: `src/app/annot-actions.test.ts`

**Interfaces:**
- Consumes: store API (Task 3), `fitSignature` (Task 4), engine API (Task 2), `runEdit`/`commitInlineEditor`/`defaultEditDeps`/`EditDeps` (E1).
- Produces:
  - `annot-actions.ts`: `SIGNATURE_WIDTH = 150`, `chooseTool(tool: Tool, deps?)`, `resolveAuthorDialog(name: string, deps?)`, `addAnnot(tabId, page, spec: NewAnnot, deps?): Promise<number | null>`, `addNote(tabId, page, at: Point, deps?)`, `placeSignature(tabId, page, at: Point, deps?)`, `updateAnnot(sel: SelectedAnnot, patch: AnnotPatch, deps?)`, `moveAnnot(sel, dx, dy, deps?)`, `resizeAnnot(sel, rect: Rect, deps?)`, `deleteSelectedAnnot(deps?)`, `dataUrlToBytes(url: string): Uint8Array`.
  - `edit-actions.ts`: `enterEditMode(tool?: EditTool, deps?)` (argument order changed: tool first); `undo`/`redo` clear `selectedAnnot`; `resolveDialog` handles `signed.then`.
  - Strings (see Step 3).

- [ ] **Step 1: Write the failing tests**

Create `src/app/annot-actions.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import type { EditResult, HistoryState } from "../edit/types";
import type { DocInfo } from "../engine/types";
import { createAppStore } from "../state/store";
import { addAnnot, addNote, chooseTool, dataUrlToBytes, deleteSelectedAnnot, placeSignature, resolveAuthorDialog } from "./annot-actions";
import { redo, resolveDialog, undo, type EditDeps } from "./edit-actions";

const clean: HistoryState = { canUndo: false, canRedo: false, dirty: false };
const dirty: HistoryState = { canUndo: true, canRedo: false, dirty: true };
const info = (over: Partial<DocInfo> = {}): DocInfo => ({
  pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false,
  editable: true, signed: false, annotatable: true, ...over,
});

function setup(docInfo = info()) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [], author: null, signatures: [] });
  const { id } = store.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" });
  store.getState().setOpenResult(id, { status: "ok", info: docInfo });
  const engine = {
    addAnnotation: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "42" })),
    updateAnnotation: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "42" })),
    deleteAnnotation: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    undo: vi.fn(async (): Promise<EditResult> => ({ history: clean })),
    redo: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
  };
  const deps = { engine, store, files: {}, tauri: true } as unknown as EditDeps;
  return { store, id, engine, deps };
}

test("choosing a tool checks permission, then the signed warning, then the author name", async () => {
  const locked = setup(info({ annotatable: false }));
  await chooseTool("markup", locked.deps);
  expect(locked.store.getState()).toMatchObject({ tool: "select", notice: { key: "annotNotAllowed" } });

  const { store, id, deps } = setup(info({ signed: true }));
  await chooseTool("markup", deps);
  expect(store.getState().dialog).toEqual({ kind: "signed", tabId: id, then: { tool: "markup" } });
  await resolveDialog("save", deps); // "Continue"
  expect(store.getState().dialog).toEqual({ kind: "author", then: "markup" });
  await resolveAuthorDialog("  මනිත්  ", deps);
  expect(store.getState()).toMatchObject({ author: "මනිත්", tool: "markup", dialog: null });
});

test("skipping the name stores an empty author and never asks again", async () => {
  const { store, deps } = setup();
  await chooseTool("draw", deps);
  await resolveAuthorDialog("", deps);
  expect(store.getState()).toMatchObject({ author: "", tool: "draw" });
  store.getState().setTool("select");
  await chooseTool("comment", deps);
  expect(store.getState()).toMatchObject({ tool: "comment", dialog: null });
});

test("picking Sign with no saved signatures opens the signature dialog", async () => {
  const { store, deps } = setup();
  store.getState().setAuthor("Leo");
  await chooseTool("sign", deps);
  expect(store.getState()).toMatchObject({ tool: "sign", dialog: { kind: "signature" } });
});

test("a markup over no text shows a notice and returns null", async () => {
  const { store, id, engine, deps } = setup();
  engine.addAnnotation.mockResolvedValueOnce({ history: clean, empty: true });
  const r = await addAnnot(id, 0, { kind: "highlight", from: [0, 0], to: [1, 1], color: [1, 1, 0] }, deps);
  expect(r).toBeNull();
  expect(store.getState().notice?.key).toBe("noTextToMark");
});

test("new annotations carry the trimmed author name", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().setAuthor(" Leo ");
  await addAnnot(id, 0, { kind: "rect", rect: [0, 0, 10, 10], color: [1, 0, 0], width: 2 }, deps);
  expect(engine.addAnnotation).toHaveBeenCalledWith(id, 0, expect.objectContaining({ kind: "rect" }), "Leo");
});

test("placing a note selects it with the comment box focused and returns to Select", async () => {
  const { store, id, deps } = setup();
  store.getState().setTool("comment");
  await addNote(id, 0, [100, 100], deps);
  expect(store.getState()).toMatchObject({ tool: "select", selectedAnnot: { tabId: id, page: 0, id: 42 }, focusComment: true });
});

test("placing a signature uses the chosen signature in a 150 pt wide box", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().addSignature({ id: "s1", png: "data:image/png;base64,AQID", width: 300, height: 100 });
  store.getState().setTool("sign");
  await placeSignature(id, 0, [200, 300], deps);
  expect(engine.addAnnotation).toHaveBeenCalledWith(id, 0, { kind: "stamp", rect: [125, 275, 275, 325], png: new Uint8Array([1, 2, 3]) }, "");
  expect(store.getState()).toMatchObject({ tool: "select", selectedAnnot: { id: 42 } });
});

test("placing without a chosen signature asks for one", async () => {
  const { store, id, engine, deps } = setup();
  await placeSignature(id, 0, [200, 300], deps);
  expect(engine.addAnnotation).not.toHaveBeenCalled();
  expect(store.getState().notice?.key).toBe("pickSignature");
});

test("deleting the selected annotation clears the selection", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 9 });
  await deleteSelectedAnnot(deps);
  expect(engine.deleteAnnotation).toHaveBeenCalledWith(id, 0, 9);
  expect(store.getState().selectedAnnot).toBeNull();
});

test("undo and redo clear the annotation selection", async () => {
  const { store, id, deps } = setup();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 9 });
  await undo(id, deps);
  expect(store.getState().selectedAnnot).toBeNull();
  store.getState().selectAnnot({ tabId: id, page: 0, id: 9 });
  await redo(id, deps);
  expect(store.getState().selectedAnnot).toBeNull();
});

test("data URLs decode to bytes", () => {
  expect(dataUrlToBytes("data:image/png;base64,AQID")).toEqual(new Uint8Array([1, 2, 3]));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/annot-actions.test.ts` — Expected: FAIL, module `./annot-actions` not found.

- [ ] **Step 3: Add the strings**

Add to `en` (before the closing `};`):

```ts
  tools: "Tools",
  toolSelectShort: "Select",
  toolComment: "Comment",
  toolHighlight: "Highlight",
  toolDraw: "Draw",
  toolSign: "Sign",
  markupHighlight: "Highlight",
  markupUnderline: "Underline",
  markupStrikeout: "Strikethrough",
  drawPen: "Pen",
  drawLine: "Line",
  drawArrow: "Arrow",
  drawRect: "Rectangle",
  drawOval: "Oval",
  color: "Colour",
  thickness: "Thickness",
  annotNote: "Comment",
  annotInk: "Drawing",
  annotStamp: "Signature",
  annotOther: "Annotation",
  comments: "Comments",
  noComments: "No comments yet",
  pageLabel: "Page {label}",
  yourName: "Your name",
  unknownAuthor: "(no name)",
  authorTitle: "Your name for comments",
  authorPrompt: "Comments and markups you add will show this name.",
  ok: "OK",
  skip: "Skip",
  annotNotAllowed: "This PDF's security settings don't allow comments.",
  noTextToMark: "There's no text there to mark.",
  commentPlaceholder: "Add a comment…",
  addSignature: "Add signature",
  signatureTitle: "Create signature",
  signDraw: "Draw",
  signType: "Type",
  signImage: "Image",
  clear: "Clear",
  inkColor: "Ink colour",
  removeWhite: "Remove white background",
  chooseImage: "Choose image…",
  typeYourName: "Type your name",
  signatureHint: "Signatures are kept only on this computer.",
  pickSignature: "Choose a signature, then click on the page",
  deleteSignature: "Delete signature",
  signatureDropped: "The oldest signature was removed (up to 5 are kept).",
  imageUnreadable: "Couldn't read that image.",
```

Add to `si`:

```ts
  tools: "මෙවලම්",
  toolSelectShort: "තෝරන්න",
  toolComment: "අදහස",
  toolHighlight: "උද්දීපනය",
  toolDraw: "අඳින්න",
  toolSign: "අත්සන් කරන්න",
  markupHighlight: "උද්දීපනය",
  markupUnderline: "යටින් ඉරි අඳින්න",
  markupStrikeout: "කපා හරින්න",
  drawPen: "පෑන",
  drawLine: "රේඛාව",
  drawArrow: "ඊතලය",
  drawRect: "සෘජුකෝණාස්‍රය",
  drawOval: "ඕවලය",
  color: "වර්ණය",
  thickness: "ඝනකම",
  annotNote: "අදහස",
  annotInk: "ඇඳීම",
  annotStamp: "අත්සන",
  annotOther: "විවරණය",
  comments: "අදහස්",
  noComments: "තවම අදහස් නැත",
  pageLabel: "පිටුව {label}",
  yourName: "ඔබේ නම",
  unknownAuthor: "(නමක් නැත)",
  authorTitle: "අදහස් සඳහා ඔබේ නම",
  authorPrompt: "ඔබ එක් කරන අදහස් සහ සලකුණු මෙම නම පෙන්වයි.",
  ok: "හරි",
  skip: "මඟ හරින්න",
  annotNotAllowed: "මෙම PDF හි ආරක්ෂක සැකසුම් අදහස් එක් කිරීමට ඉඩ නොදේ.",
  noTextToMark: "එහි සලකුණු කිරීමට පෙළක් නැත.",
  commentPlaceholder: "අදහසක් එක් කරන්න…",
  addSignature: "අත්සනක් එක් කරන්න",
  signatureTitle: "අත්සනක් සාදන්න",
  signDraw: "අඳින්න",
  signType: "ටයිප් කරන්න",
  signImage: "රූපය",
  clear: "හිස් කරන්න",
  inkColor: "තීන්ත වර්ණය",
  removeWhite: "සුදු පසුබිම ඉවත් කරන්න",
  chooseImage: "රූපයක් තෝරන්න…",
  typeYourName: "ඔබේ නම ටයිප් කරන්න",
  signatureHint: "අත්සන් ගබඩා වන්නේ මෙම පරිගණකයේ පමණි.",
  pickSignature: "අත්සනක් තෝරා, පසුව පිටුව මත ක්ලික් කරන්න",
  deleteSignature: "අත්සන මකන්න",
  signatureDropped: "පැරණිම අත්සන ඉවත් කරන ලදී (උපරිම 5ක් තබා ගනී).",
  imageUnreadable: "එම රූපය කියවිය නොහැකි විය.",
```

Add to `ta`:

```ts
  tools: "கருவிகள்",
  toolSelectShort: "தேர்ந்தெடு",
  toolComment: "கருத்து",
  toolHighlight: "முன்னிலைப்படுத்து",
  toolDraw: "வரை",
  toolSign: "கையொப்பமிடு",
  markupHighlight: "முன்னிலைப்படுத்து",
  markupUnderline: "அடிக்கோடிடு",
  markupStrikeout: "அடித்துவிடு",
  drawPen: "பேனா",
  drawLine: "கோடு",
  drawArrow: "அம்புக்குறி",
  drawRect: "செவ்வகம்",
  drawOval: "நீள்வட்டம்",
  color: "நிறம்",
  thickness: "தடிமன்",
  annotNote: "கருத்து",
  annotInk: "வரைதல்",
  annotStamp: "கையொப்பம்",
  annotOther: "குறிப்பு",
  comments: "கருத்துகள்",
  noComments: "இன்னும் கருத்துகள் இல்லை",
  pageLabel: "பக்கம் {label}",
  yourName: "உங்கள் பெயர்",
  unknownAuthor: "(பெயர் இல்லை)",
  authorTitle: "கருத்துகளுக்கான உங்கள் பெயர்",
  authorPrompt: "நீங்கள் சேர்க்கும் கருத்துகளும் குறிகளும் இந்தப் பெயரைக் காட்டும்.",
  ok: "சரி",
  skip: "தவிர்",
  annotNotAllowed: "இந்த PDF இன் பாதுகாப்பு அமைப்புகள் கருத்துகளைச் சேர்க்க அனுமதிக்கவில்லை.",
  noTextToMark: "அங்கே குறிக்க உரை இல்லை.",
  commentPlaceholder: "கருத்தைச் சேர்…",
  addSignature: "கையொப்பத்தைச் சேர்",
  signatureTitle: "கையொப்பத்தை உருவாக்கு",
  signDraw: "வரை",
  signType: "தட்டச்சு",
  signImage: "படம்",
  clear: "அழி",
  inkColor: "மை நிறம்",
  removeWhite: "வெள்ளைப் பின்னணியை நீக்கு",
  chooseImage: "படத்தைத் தேர்ந்தெடு…",
  typeYourName: "உங்கள் பெயரைத் தட்டச்சு செய்க",
  signatureHint: "கையொப்பங்கள் இந்தக் கணினியில் மட்டுமே வைக்கப்படும்.",
  pickSignature: "ஒரு கையொப்பத்தைத் தேர்ந்தெடுத்து, பக்கத்தில் கிளிக் செய்யவும்",
  deleteSignature: "கையொப்பத்தை நீக்கு",
  signatureDropped: "பழைய கையொப்பம் நீக்கப்பட்டது (அதிகபட்சம் 5 வைக்கப்படும்).",
  imageUnreadable: "அந்தப் படத்தைப் படிக்க முடியவில்லை.",
```

(`signatureNotSaved` was added in Task 3.)

- [ ] **Step 4: Implement `src/app/annot-actions.ts`**

```ts
import type { AnnotPatch, NewAnnot } from "../edit/types";
import type { Point, Rect } from "../engine/types";
import { activeTab, type SelectedAnnot, type Tool } from "../state/store";
import { fitSignature } from "../viewer/annot-geometry";
import { commitInlineEditor, defaultEditDeps, runEdit, type EditDeps } from "./edit-actions";

/** Default width of a placed signature, in points (about 5 cm). */
export const SIGNATURE_WIDTH = 150;

export function dataUrlToBytes(url: string): Uint8Array {
  return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
}

/**
 * Picks a rail tool. Select and Hand are always allowed; the annotation tools change the document,
 * so they check the PDF's permissions, the signed-PDF warning and the author name first.
 */
export async function chooseTool(tool: Tool, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  if (s.inlineEditor) await commitInlineEditor(deps);
  if (tool === "select" || tool === "hand") return s.setTool(tool);
  const tab = activeTab(s);
  if (!tab?.info) return;
  if (!tab.info.annotatable) return s.showNotice("annotNotAllowed");
  if (tab.info.signed && !tab.signedAcknowledged) return s.setDialog({ kind: "signed", tabId: tab.id, then: { tool } });
  if (s.author === null) return s.setDialog({ kind: "author", then: tool });
  s.setTool(tool);
  if (tool === "sign") {
    const now = deps.store.getState();
    if (now.signatures.length === 0) now.setDialog({ kind: "signature" });
    else if (!now.signatures.some((x) => x.id === now.signatureId)) now.setSignatureId(now.signatures[0].id);
  }
}

export async function resolveAuthorDialog(name: string, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const dialog = s.dialog;
  s.setDialog(null);
  s.setAuthor(name.trim());
  if (dialog?.kind === "author") await chooseTool(dialog.then, deps);
}

/** Adds an annotation; returns its id, or null if nothing was added. */
export async function addAnnot(tabId: string, page: number, spec: NewAnnot, deps: EditDeps = defaultEditDeps()): Promise<number | null> {
  const s = deps.store.getState();
  const result = await runEdit(tabId, () => deps.engine.addAnnotation(tabId, page, spec, (s.author ?? "").trim()), deps);
  if (!result) return null;
  if (result.empty) {
    s.showNotice("noTextToMark");
    return null;
  }
  return result.id ? Number(result.id) : null;
}

export async function addNote(tabId: string, page: number, at: Point, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const id = await addAnnot(tabId, page, { kind: "note", at, contents: "" }, deps);
  if (id === null) return;
  const s = deps.store.getState();
  s.setTool("select");
  s.selectAnnot({ tabId, page, id }, true);
}

export async function placeSignature(tabId: string, page: number, at: Point, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const sig = s.signatures.find((x) => x.id === s.signatureId);
  if (!sig) return s.showNotice("pickSignature");
  const rect = fitSignature(at, SIGNATURE_WIDTH, sig.width / sig.height);
  const id = await addAnnot(tabId, page, { kind: "stamp", rect, png: dataUrlToBytes(sig.png) }, deps);
  if (id === null) return;
  s.setTool("select");
  s.selectAnnot({ tabId, page, id });
}

export const updateAnnot = (sel: SelectedAnnot, patch: AnnotPatch, deps: EditDeps = defaultEditDeps()) =>
  runEdit(sel.tabId, () => deps.engine.updateAnnotation(sel.tabId, sel.page, sel.id, patch), deps);

export const moveAnnot = (sel: SelectedAnnot, dx: number, dy: number, deps: EditDeps = defaultEditDeps()) =>
  runEdit(sel.tabId, () => deps.engine.moveAnnotation(sel.tabId, sel.page, sel.id, dx, dy), deps);

export const resizeAnnot = (sel: SelectedAnnot, rect: Rect, deps: EditDeps = defaultEditDeps()) =>
  runEdit(sel.tabId, () => deps.engine.resizeAnnotation(sel.tabId, sel.page, sel.id, rect), deps);

export async function deleteSelectedAnnot(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const sel = s.selectedAnnot;
  if (!sel) return;
  s.selectAnnot(null);
  await runEdit(sel.tabId, () => deps.engine.deleteAnnotation(sel.tabId, sel.page, sel.id), deps);
}
```

- [ ] **Step 5: Update `edit-actions.ts` and `ConfirmDialog.tsx`**

`src/app/edit-actions.ts`:

```ts
import type { EditTool } from "../state/store"; // add to the existing store import
import { chooseTool } from "./annot-actions"; // functions only — the import cycle is safe
```

Replace `undo`/`redo`:

```ts
export function undo(tabId: string, deps: EditDeps = defaultEditDeps()) {
  deps.store.getState().selectAnnot(null);
  return runEdit(tabId, () => deps.engine.undo(tabId), deps);
}

export function redo(tabId: string, deps: EditDeps = defaultEditDeps()) {
  deps.store.getState().selectAnnot(null);
  return runEdit(tabId, () => deps.engine.redo(tabId), deps);
}
```

In `resolveDialog`, replace the `signed` branch (the `unsaved` guard from Task 3 stays):

```ts
  if (dialog.kind === "signed") {
    s.acknowledgeSigned(dialog.tabId);
    if ("tool" in dialog.then) await chooseTool(dialog.then.tool, deps);
    else {
      s.setEditMode(true);
      s.setEditTool(dialog.then.edit);
    }
    return;
  }
  if (dialog.kind !== "unsaved") return;
```

Replace `enterEditMode`:

```ts
export async function enterEditMode(tool: EditTool = "select", deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const tab = activeTab(s);
  if (!tab?.info) return;
  if (!tab.info.editable) {
    s.showNotice("editNotAllowed");
    return;
  }
  if (tab.info.signed && !tab.signedAcknowledged) {
    s.setDialog({ kind: "signed", tabId: tab.id, then: { edit: tool } });
    return;
  }
  s.setEditMode(true);
  s.setEditTool(tool);
}
```

In `src/app/edit-actions.test.ts` change every `enterEditMode(deps)` call to `enterEditMode("select", deps)`.

In `src/app/Toolbar.tsx` change `void enterEditMode()` to `void enterEditMode("select")` (the button is removed in Task 6).

(`ConfirmDialog` already ignores the author and signature dialogs since Task 3.)

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS (strings test confirms all three languages have every key).

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(app): annotation actions with permission, signed-PDF and author gating

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tool rail, options bar, author dialog and layout

**Files:**
- Create: `src/app/ToolRail.tsx`, `src/app/ToolOptionsBar.tsx`, `src/app/Swatches.tsx`, `src/app/AuthorDialog.tsx`
- Modify: `src/app/Toolbar.tsx`, `src/app/App.tsx`, `src/app/app.css`
- Test: `src/app/ToolRail.test.tsx`

**Interfaces:**
- Consumes: `chooseTool`, `resolveAuthorDialog` (Task 5), `enterEditMode(tool)` (Task 5), store (Task 3), palette (Task 3).
- Produces: `<ToolRail />`, `<ToolOptionsBar />`, `<Swatches colors value onPick />` (reused by Task 7's card), `<AuthorDialog />`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/ToolRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MARKUP_COLORS, toHex } from "../state/palette";
import { appStore } from "../state/store";
import { AuthorDialog } from "./AuthorDialog";
import { ToolOptionsBar } from "./ToolOptionsBar";
import { ToolRail } from "./ToolRail";

vi.mock("../engine/client", () => ({ getEngine: () => ({}) }));

beforeEach(() => {
  appStore.setState({
    tabs: [], activeId: null, lang: "en", editMode: false, editTool: "select", tool: "select", dialog: null, notice: null,
    author: "Leo", signatures: [], signatureId: null,
  });
  const { id } = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" });
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true },
  });
});
afterEach(cleanup);

test("the rail picks tools and shows which one is active", async () => {
  render(<ToolRail />);
  fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
  await waitFor(() => expect(appStore.getState().tool).toBe("markup"));
  expect(screen.getByRole("button", { name: "Highlight" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Add text" }));
  await waitFor(() => expect(appStore.getState()).toMatchObject({ editMode: true, editTool: "text" }));
  expect(screen.getByRole("button", { name: "Highlight" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  await waitFor(() => expect(appStore.getState()).toMatchObject({ editMode: false, tool: "select" }));
});

test("the options bar changes markup kind and colour, draw shape and thickness", () => {
  appStore.getState().setTool("markup");
  const { rerender } = render(<ToolOptionsBar />);
  fireEvent.click(screen.getByRole("button", { name: "Underline" }));
  fireEvent.click(screen.getByRole("button", { name: toHex(MARKUP_COLORS[1]) }));
  expect(appStore.getState().markupStyle).toMatchObject({ kind: "underline", colors: { underline: MARKUP_COLORS[1] } });
  appStore.getState().setTool("draw");
  rerender(<ToolOptionsBar />);
  fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
  fireEvent.change(screen.getByLabelText("Thickness"), { target: { value: "4" } });
  expect(appStore.getState().drawStyle).toMatchObject({ shape: "arrow", width: 4 });
});

test("the Sign options list saved signatures and open the creator", () => {
  appStore.getState().addSignature({ id: "s1", png: "data:image/png;base64,AA==", width: 10, height: 4 });
  appStore.getState().setTool("sign");
  render(<ToolOptionsBar />);
  fireEvent.click(screen.getByRole("button", { name: "Add signature" }));
  expect(appStore.getState().dialog).toEqual({ kind: "signature" });
  fireEvent.click(screen.getByRole("button", { name: "Delete signature" }));
  expect(appStore.getState().signatures).toEqual([]);
});

test("the author dialog saves the name and continues to the tool", async () => {
  appStore.setState({ author: null, dialog: { kind: "author", then: "comment" } });
  render(<AuthorDialog />);
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "මනිත්" } });
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(appStore.getState()).toMatchObject({ author: "මනිත්", tool: "comment", dialog: null }));
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/app/ToolRail.test.tsx` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/app/Swatches.tsx`**

```tsx
import type { RGB } from "../edit/types";
import { useT } from "../i18n/useT";
import { sameColor, toHex } from "../state/palette";

export function Swatches({ colors, value, onPick }: { colors: RGB[]; value: RGB | null; onPick(color: RGB): void }) {
  const t = useT();
  return (
    <div className="swatches" role="group" aria-label={t("color")}>
      {colors.map((c) => {
        const on = value !== null && sameColor(c, value);
        return (
          <button key={toHex(c)} className={`swatch ${on ? "pressed" : ""}`} style={{ background: toHex(c) }} aria-label={toHex(c)} aria-pressed={on} title={toHex(c)} onClick={() => onPick(c)} />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/ToolRail.tsx`**

```tsx
import { Highlighter, MessageSquarePlus, MousePointer2, PenLine, Pencil, Signature, Type, type LucideIcon } from "lucide-react";
import type { StringKey } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { useApp, type Tool } from "../state/store";
import { chooseTool } from "./annot-actions";
import { enterEditMode } from "./edit-actions";

type RailId = Exclude<Tool, "hand"> | "addText" | "editPdf";

const ITEMS: { id: RailId; icon: LucideIcon; label: StringKey }[] = [
  { id: "select", icon: MousePointer2, label: "toolSelectShort" },
  { id: "comment", icon: MessageSquarePlus, label: "toolComment" },
  { id: "markup", icon: Highlighter, label: "toolHighlight" },
  { id: "draw", icon: Pencil, label: "toolDraw" },
  { id: "addText", icon: Type, label: "addText" },
  { id: "sign", icon: Signature, label: "toolSign" },
  { id: "editPdf", icon: PenLine, label: "editPdf" },
];

/** Acrobat-style vertical tool rail. "Add text" and "Edit PDF" enter E1's Edit mode. */
export function ToolRail() {
  const t = useT();
  const tool = useApp((s) => s.tool);
  const editMode = useApp((s) => s.editMode);
  const editTool = useApp((s) => s.editTool);
  const setEditMode = useApp((s) => s.setEditMode);

  const pressed = (id: RailId) =>
    id === "addText" ? editMode && editTool === "text" : id === "editPdf" ? editMode && editTool === "select" : !editMode && tool === id;
  const onClick = (id: RailId) => {
    if (id === "addText" || id === "editPdf") {
      if (pressed(id)) setEditMode(false);
      else void enterEditMode(id === "addText" ? "text" : "select");
    } else void chooseTool(id);
  };

  return (
    <nav className="tool-rail" aria-label={t("tools")}>
      {ITEMS.map(({ id, icon: Icon, label }) => (
        <button key={id} className={`rail-tool ${pressed(id) ? "pressed" : ""}`} aria-pressed={pressed(id)} title={t(label)} onClick={() => onClick(id)}>
          <Icon size={20} aria-hidden />
          <span>{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Implement `src/app/ToolOptionsBar.tsx`**

```tsx
import { ArrowUpRight, Circle, Highlighter, Minus, Pencil, Plus, Square, Strikethrough, Underline, X, type LucideIcon } from "lucide-react";
import type { StringKey } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { DRAW_COLORS, DRAW_WIDTHS, MARKUP_COLORS } from "../state/palette";
import { appStore, useApp, type DrawShape, type MarkupKind } from "../state/store";
import { Swatches } from "./Swatches";

const MARKUPS: { kind: MarkupKind; icon: LucideIcon; label: StringKey }[] = [
  { kind: "highlight", icon: Highlighter, label: "markupHighlight" },
  { kind: "underline", icon: Underline, label: "markupUnderline" },
  { kind: "strikeout", icon: Strikethrough, label: "markupStrikeout" },
];
const SHAPES: { shape: DrawShape; icon: LucideIcon; label: StringKey }[] = [
  { shape: "pen", icon: Pencil, label: "drawPen" },
  { shape: "line", icon: Minus, label: "drawLine" },
  { shape: "arrow", icon: ArrowUpRight, label: "drawArrow" },
  { shape: "rect", icon: Square, label: "drawRect" },
  { shape: "oval", icon: Circle, label: "drawOval" },
];

function ToggleButton({ on, label, icon: Icon, onClick }: { on: boolean; label: string; icon: LucideIcon; onClick(): void }) {
  return (
    <button className={`icon-button ${on ? "pressed" : ""}`} aria-label={label} aria-pressed={on} title={label} onClick={onClick}>
      <Icon size={18} />
    </button>
  );
}

/** Options for the active rail tool (Highlight, Draw, Sign), shown where E1's Edit bar goes. */
export function ToolOptionsBar() {
  const t = useT();
  const tool = useApp((s) => s.tool);
  const markup = useApp((s) => s.markupStyle);
  const draw = useApp((s) => s.drawStyle);
  const signatures = useApp((s) => s.signatures);
  const signatureId = useApp((s) => s.signatureId);
  const s = appStore.getState();

  if (tool === "markup")
    return (
      <div className="editbar tool-options" role="toolbar" aria-label={t("toolHighlight")}>
        {MARKUPS.map((m) => (
          <ToggleButton key={m.kind} on={markup.kind === m.kind} label={t(m.label)} icon={m.icon} onClick={() => s.setMarkupStyle({ kind: m.kind })} />
        ))}
        <div className="separator" />
        <Swatches colors={MARKUP_COLORS} value={markup.colors[markup.kind]} onPick={(color) => s.setMarkupStyle({ color })} />
      </div>
    );

  if (tool === "draw")
    return (
      <div className="editbar tool-options" role="toolbar" aria-label={t("toolDraw")}>
        {SHAPES.map((d) => (
          <ToggleButton key={d.shape} on={draw.shape === d.shape} label={t(d.label)} icon={d.icon} onClick={() => s.setDrawStyle({ shape: d.shape })} />
        ))}
        <div className="separator" />
        <Swatches colors={DRAW_COLORS} value={draw.color} onPick={(color) => s.setDrawStyle({ color })} />
        <select aria-label={t("thickness")} title={t("thickness")} value={draw.width} onChange={(e) => s.setDrawStyle({ width: Number(e.target.value) })}>
          {DRAW_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w} pt
            </option>
          ))}
        </select>
      </div>
    );

  if (tool === "sign")
    return (
      <div className="editbar tool-options" role="toolbar" aria-label={t("toolSign")}>
        {signatures.map((sig) => (
          <span key={sig.id} className={`signature-chip ${sig.id === signatureId ? "pressed" : ""}`}>
            <button className="signature-pick" aria-label={t("toolSign")} aria-pressed={sig.id === signatureId} onClick={() => s.setSignatureId(sig.id)}>
              <img src={sig.png} alt="" />
            </button>
            <button className="icon-button small" aria-label={t("deleteSignature")} title={t("deleteSignature")} onClick={() => s.removeSignature(sig.id)}>
              <X size={12} />
            </button>
          </span>
        ))}
        <button className="primary-button" onClick={() => s.setDialog({ kind: "signature" })}>
          <Plus size={16} /> {t("addSignature")}
        </button>
        <div className="spacer" />
        <span className="muted">{t(signatures.length ? "pickSignature" : "signatureHint")}</span>
      </div>
    );

  return null;
}
```

- [ ] **Step 6: Implement `src/app/AuthorDialog.tsx`**

```tsx
import { useState } from "react";
import { useT } from "../i18n/useT";
import { useApp } from "../state/store";
import { resolveAuthorDialog } from "./annot-actions";

/** Asked once, the first time an annotation tool is picked. */
export function AuthorDialog() {
  const t = useT();
  const dialog = useApp((s) => s.dialog);
  const [name, setName] = useState("");
  if (dialog?.kind !== "author") return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("authorTitle")}>
      <form
        className="doc-message password-form"
        onSubmit={(e) => {
          e.preventDefault();
          void resolveAuthorDialog(name);
        }}
      >
        <h2>{t("authorTitle")}</h2>
        <p>{t("authorPrompt")}</p>
        <input autoFocus aria-label={t("yourName")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="form-actions">
          <button type="button" onClick={() => void resolveAuthorDialog("")}>
            {t("skip")}
          </button>
          <button type="submit" className="primary-button">
            {t("ok")}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Toolbar and App layout**

`src/app/Toolbar.tsx`: delete the "Select text" button, the separator after Hand, and the "Edit PDF" button (with the `PenLine`, `TextCursor` and `enterEditMode` imports). Change the Hand button to toggle:

```tsx
      <IconButton label={t("toolHand")} pressed={s.tool === "hand"} onClick={() => s.setTool(s.tool === "hand" ? "select" : "hand")}>
        <Hand size={18} />
      </IconButton>
```

`src/app/App.tsx`:
- imports: `ToolRail`, `ToolOptionsBar`, `AuthorDialog`;
- replace `{tab?.status === "ready" && editMode && <EditBar tab={tab} />}` with:

```tsx
      {tab?.status === "ready" && (editMode ? <EditBar tab={tab} /> : <ToolOptionsBar />)}
```

- inside the ready `TabErrorBoundary`, before `<LeftPanel tab={tab} />`: `<ToolRail />`;
- after `<ConfirmDialog />`: `<AuthorDialog />`.

- [ ] **Step 8: CSS** — append to `src/app/app.css`:

```css
.tool-rail { display: flex; flex-direction: column; gap: 2px; padding: 8px 4px; background: var(--panel); border-right: 1px solid var(--border); overflow-y: auto; }
.rail-tool {
  display: flex; flex-direction: column; align-items: center; gap: 2px; width: 64px; padding: 6px 2px; border: none; border-radius: 8px;
  background: none; color: inherit; cursor: pointer; font-size: 11px; line-height: 1.2; text-align: center;
}
.rail-tool:hover { background: var(--accent-soft); }
.rail-tool.pressed { background: var(--accent-soft); color: var(--accent); }
.rail-tool span { max-width: 100%; overflow-wrap: anywhere; }
.swatches { display: flex; gap: 4px; }
.swatch { width: 20px; height: 20px; padding: 0; border-radius: 50%; border: 2px solid var(--panel); box-shadow: 0 0 0 1px var(--border); cursor: pointer; }
.swatch.pressed { box-shadow: 0 0 0 2px var(--accent); }
.signature-chip { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); }
.signature-chip.pressed { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.signature-pick { padding: 2px 6px; border: none; border-radius: 6px 0 0 6px; background: #fff; cursor: pointer; }
.signature-pick img { display: block; height: 24px; max-width: 120px; object-fit: contain; }
```

- [ ] **Step 9: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS / no errors / build succeeds.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat(app): Acrobat-style tool rail, tool options bar and author dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Annotation layer, comment card and shortcuts

**Files:**
- Create: `src/viewer/AnnotationLayer.tsx`, `src/viewer/AnnotCard.tsx`, `src/app/annot-labels.ts`
- Modify: `src/viewer/PageSlot.tsx`, `src/app/useShortcuts.ts`, `src/app/app.css`
- Test: `src/viewer/AnnotCard.test.tsx`, `src/viewer/AnnotationLayer.test.tsx`

**Interfaces:**
- Consumes: `listAnnotations` via `getEngine()` (Task 2), annot-actions (Task 5), geometry (Task 4), `Swatches` (Task 6), palette + store (Task 3).
- Produces: `<AnnotationLayer tab page transform />`, `<AnnotCard annot tab anchor pageWidth />`, `KIND_LABEL: Record<AnnotKind, StringKey>`, `KIND_ICON: Record<AnnotKind, LucideIcon>`, `DRAW_KINDS`, `MARKUP_KINDS` sets.

- [ ] **Step 1: Write the failing tests**

Create `src/viewer/AnnotCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annot } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { AnnotCard } from "./AnnotCard";

const engine = vi.hoisted(() => ({
  updateAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true }, id: "5" })),
  deleteAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true } })),
}));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

const note: Annot = {
  id: 5, page: 0, kind: "note", subtype: "Text", rect: [100, 100, 120, 120], box: [100, 100, 120, 120],
  color: [1, 0.84, 0], contents: "", author: "Leo", modified: Date.UTC(2026, 8, 29), movable: true, resizable: false,
};
let tabId: string;
beforeEach(() => {
  engine.updateAnnotation.mockClear();
  engine.deleteAnnotation.mockClear();
  appStore.setState({ tabs: [], activeId: null, lang: "en", selectedAnnot: null, focusComment: false });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().selectAnnot({ tabId, page: 0, id: 5 });
});
afterEach(cleanup);
const tab = () => getTab(appStore.getState(), tabId)!;

test("typing a Sinhala comment and leaving the box saves it once", async () => {
  render(<AnnotCard annot={note} tab={tab()} anchor={[100, 100, 120, 120]} pageWidth={600} />);
  expect(screen.getByText(/Leo/)).toBeTruthy();
  const box = screen.getByLabelText("Add a comment…");
  fireEvent.change(box, { target: { value: "ශ්‍රී ලංකාව" } });
  fireEvent.blur(box);
  await waitFor(() => expect(engine.updateAnnotation).toHaveBeenCalledWith(tabId, 0, 5, { contents: "ශ්‍රී ලංකාව" }));
  cleanup();
  expect(engine.updateAnnotation).toHaveBeenCalledTimes(1);
});

test("unmounting with unsaved text saves it", async () => {
  const { unmount } = render(<AnnotCard annot={note} tab={tab()} anchor={[100, 100, 120, 120]} pageWidth={600} />);
  fireEvent.change(screen.getByLabelText("Add a comment…"), { target: { value: "யாழ்ப்பாணம்" } });
  unmount();
  await waitFor(() => expect(engine.updateAnnotation).toHaveBeenCalledWith(tabId, 0, 5, { contents: "யாழ்ப்பாணம்" }));
});

test("delete removes the annotation and clears the selection", async () => {
  render(<AnnotCard annot={note} tab={tab()} anchor={[100, 100, 120, 120]} pageWidth={600} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(engine.deleteAnnotation).toHaveBeenCalledWith(tabId, 0, 5));
  expect(appStore.getState().selectedAnnot).toBeNull();
});
```

Create `src/viewer/AnnotationLayer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annot } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { AnnotationLayer } from "./AnnotationLayer";
import { pageTransform } from "./geometry";

if (!window.PointerEvent) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;

const ink: Annot = {
  id: 7, page: 0, kind: "ink", subtype: "Ink", rect: [10, 10, 60, 60], box: [10, 10, 60, 60], strokes: [[[10, 10], [60, 60]]],
  color: [1, 0, 0], contents: "", author: "", modified: null, movable: true, resizable: false,
};
const engine = vi.hoisted(() => ({
  listAnnotations: vi.fn(async () => [] as Annot[]),
  addAnnotation: vi.fn(async () => ({ history: { canUndo: true, canRedo: false, dirty: true }, id: "8" })),
}));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

let tabId: string;
beforeEach(() => {
  engine.addAnnotation.mockClear();
  engine.listAnnotations.mockResolvedValue([ink]);
  appStore.setState({ tabs: [], activeId: null, lang: "en", tool: "select", editMode: false, selectedAnnot: null, author: "Leo" });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
});
afterEach(cleanup);

async function renderLayer() {
  const view = render(<AnnotationLayer tab={getTab(appStore.getState(), tabId)!} page={0} transform={pageTransform([0, 0, 600, 800], 1, 0)} />);
  await act(async () => {});
  return view;
}

test("clicking an annotation's stroke selects it", async () => {
  const { container } = await renderLayer();
  fireEvent.pointerDown(container.querySelector(".annot-hit")!, { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
  expect(appStore.getState().selectedAnnot).toEqual({ tabId, page: 0, id: 7 });
});

test("the pen tool turns a drag into an ink annotation", async () => {
  appStore.setState({ tool: "draw", drawStyle: { shape: "pen", color: [0, 0, 0], width: 2 } });
  const { container } = await renderLayer();
  const capture = container.querySelector(".annot-capture")!;
  fireEvent.pointerDown(capture, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(capture, { clientX: 120, clientY: 110, pointerId: 1 });
  fireEvent.pointerUp(capture, { clientX: 140, clientY: 120, pointerId: 1 });
  await act(async () => {});
  expect(engine.addAnnotation).toHaveBeenCalledWith(tabId, 0, { kind: "ink", strokes: [[[100, 100], [120, 110], [140, 120]]], color: [0, 0, 0], width: 2 }, "Leo");
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/viewer/AnnotCard.test.tsx src/viewer/AnnotationLayer.test.tsx` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/app/annot-labels.ts`**

```ts
import { ArrowUpRight, Circle, Highlighter, MessageSquare, Minus, Pencil, Signature, Square, Strikethrough, StickyNote, Underline, type LucideIcon } from "lucide-react";
import type { AnnotKind } from "../edit/types";
import type { StringKey } from "../i18n/strings";

export const KIND_LABEL: Record<AnnotKind, StringKey> = {
  highlight: "markupHighlight", underline: "markupUnderline", strikeout: "markupStrikeout", ink: "annotInk", line: "drawLine", arrow: "drawArrow",
  rect: "drawRect", oval: "drawOval", note: "annotNote", stamp: "annotStamp", other: "annotOther",
};

export const KIND_ICON: Record<AnnotKind, LucideIcon> = {
  highlight: Highlighter, underline: Underline, strikeout: Strikethrough, ink: Pencil, line: Minus, arrow: ArrowUpRight,
  rect: Square, oval: Circle, note: StickyNote, stamp: Signature, other: MessageSquare,
};

export const MARKUP_KINDS = new Set<AnnotKind>(["highlight", "underline", "strikeout"]);
export const DRAW_KINDS = new Set<AnnotKind>(["ink", "line", "arrow", "rect", "oval"]);
```

- [ ] **Step 4: Implement `src/viewer/AnnotCard.tsx`**

```tsx
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteSelectedAnnot, updateAnnot } from "../app/annot-actions";
import { DRAW_KINDS, KIND_LABEL, MARKUP_KINDS } from "../app/annot-labels";
import { Swatches } from "../app/Swatches";
import type { Annot } from "../edit/types";
import type { Rect } from "../engine/types";
import { useT } from "../i18n/useT";
import { DRAW_COLORS, MARKUP_COLORS } from "../state/palette";
import { appStore, useApp, type DocTab } from "../state/store";

const CARD_WIDTH = 240;

/** Comment box for the selected annotation: author/date, comment text, colour, delete. */
export function AnnotCard({ annot, tab, anchor, pageWidth }: { annot: Annot; tab: DocTab; anchor: Rect; pageWidth: number }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const focus = useApp((s) => s.focusComment);
  const [text, setText] = useState(annot.contents);
  const saved = useRef(annot.contents);
  const latest = useRef(text);
  latest.current = text;
  const box = useRef<HTMLTextAreaElement>(null);
  const sel = { tabId: tab.id, page: annot.page, id: annot.id };

  useEffect(() => {
    setText(annot.contents);
    saved.current = annot.contents;
  }, [annot.id, annot.contents]);
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus, annot.id]);

  const commit = () => {
    if (latest.current === saved.current) return;
    saved.current = latest.current;
    void updateAnnot(sel, { contents: latest.current });
  };
  // Clicking elsewhere can unmount the card before the textarea's blur fires: save then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => commit, [annot.id]);

  const colors = MARKUP_KINDS.has(annot.kind) ? MARKUP_COLORS : DRAW_KINDS.has(annot.kind) ? DRAW_COLORS : null;
  const left = anchor[2] + 8 + CARD_WIDTH <= pageWidth ? anchor[2] + 8 : Math.max(0, anchor[0] - CARD_WIDTH - 8);
  const when = annot.modified ? ` · ${new Date(annot.modified).toLocaleString(lang)}` : "";

  return (
    <div className="annot-card" style={{ left, top: anchor[1], width: CARD_WIDTH }} role="dialog" aria-label={t(KIND_LABEL[annot.kind])} onPointerDown={(e) => e.stopPropagation()}>
      <div className="annot-card-head">
        <strong>{t(KIND_LABEL[annot.kind])}</strong>
        <span className="muted">
          {annot.author || t("unknownAuthor")}
          {when}
        </span>
      </div>
      <textarea
        ref={box}
        value={text}
        rows={3}
        placeholder={t("commentPlaceholder")}
        aria-label={t("commentPlaceholder")}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") appStore.getState().selectAnnot(null);
        }}
      />
      <div className="annot-card-actions">
        {colors && <Swatches colors={colors} value={annot.color} onPick={(color) => void updateAnnot(sel, { color })} />}
        <div className="spacer" />
        <button
          className="icon-button"
          aria-label={t("deleteItem")}
          title={t("deleteItem")}
          onClick={() => {
            saved.current = latest.current; // nothing to save for an annotation being deleted
            void deleteSelectedAnnot();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/viewer/AnnotationLayer.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { SIGNATURE_WIDTH, addAnnot, addNote, moveAnnot, placeSignature, resizeAnnot } from "../app/annot-actions";
import { getEngine } from "../engine/client";
import type { Annot } from "../edit/types";
import type { Point, Rect } from "../engine/types";
import { cssColor } from "../state/palette";
import { appStore, useApp, type DocTab } from "../state/store";
import { AnnotCard } from "./AnnotCard";
import { dragRect, drawSpec, fitSignature, pointsAttr, quadBox, resizeBox, shiftRect } from "./annot-geometry";
import type { PageTransform } from "./geometry";

type Gesture =
  | { kind: "move" | "resize"; annot: Annot; start: Point; delta: Point }
  | { kind: "stroke"; points: Point[] }
  | { kind: "markup"; from: Point; rects: Rect[] }
  | null;

/** Width in CSS px of the invisible hit area around ink and lines. */
const HIT_WIDTH = 10;

function AnnotHit({ annot, transform, onPointerDown }: { annot: Annot; transform: PageTransform; onPointerDown(e: React.PointerEvent): void }) {
  if (annot.quads?.length)
    return (
      <g className="annot-hit" onPointerDown={onPointerDown}>
        {annot.quads.map((q, i) => {
          const [x0, y0, x1, y1] = transform.rectToDisplay(quadBox(q));
          return <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} />;
        })}
      </g>
    );
  if (annot.strokes && (annot.kind === "ink" || annot.kind === "line" || annot.kind === "arrow"))
    return (
      <g className="annot-hit stroke" onPointerDown={onPointerDown}>
        {annot.strokes.map((s, i) => (
          <polyline key={i} points={pointsAttr(s, transform)} strokeWidth={HIT_WIDTH} />
        ))}
      </g>
    );
  const [x0, y0, x1, y1] = transform.rectToDisplay(annot.rect);
  return <rect className="annot-hit" x={x0} y={y0} width={x1 - x0} height={y1 - y0} onPointerDown={onPointerDown} />;
}

/** Annotation input and selection for one page (not used in Edit mode). The annotations themselves are drawn by MuPDF. */
export function AnnotationLayer({ tab, page, transform }: { tab: DocTab; page: number; transform: PageTransform }) {
  const tool = useApp((s) => s.tool);
  const selected = useApp((s) => s.selectedAnnot);
  const markup = useApp((s) => s.markupStyle);
  const draw = useApp((s) => s.drawStyle);
  const signature = useApp((s) => s.signatures.find((x) => x.id === s.signatureId) ?? null);
  const [annots, setAnnots] = useState<Annot[]>([]);
  const [gesture, setGesture] = useState<Gesture>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getEngine()
      .listAnnotations(tab.id, page)
      .then((list: Annot[]) => !cancelled && setAnnots(list));
    return () => {
      cancelled = true;
    };
  }, [tab.id, page, tab.revision]);

  const pagePoint = (e: React.PointerEvent): Point => {
    const box = layer.current!.getBoundingClientRect();
    return transform.toPage([e.clientX - box.left, e.clientY - box.top]);
  };
  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the gesture still works while the pointer stays on the page.
    }
  };
  const minSize = 2 / tab.zoom;
  const current = annots.find((a) => selected?.tabId === tab.id && selected.page === page && selected.id === a.id) ?? null;

  const onAnnotDown = (annot: Annot, kind: "move" | "resize") => (e: React.PointerEvent) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const s = appStore.getState();
    s.setSelection(tab.id, null);
    s.selectAnnot({ tabId: tab.id, page, id: annot.id });
    if (kind === "resize" ? annot.resizable : annot.movable) {
      capture(e);
      setGesture({ kind, annot, start: pagePoint(e), delta: [0, 0] });
    }
  };

  const onCaptureDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pagePoint(e);
    if (tool === "comment") return void addNote(tab.id, page, p);
    if (tool === "sign") return void placeSignature(tab.id, page, p);
    capture(e);
    setGesture(tool === "markup" ? { kind: "markup", from: p, rects: [] } : { kind: "stroke", points: [p] });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = pagePoint(e);
    if (tool === "sign") setHover(p);
    const g = gesture;
    if (!g) return;
    if (g.kind === "move" || g.kind === "resize") setGesture({ ...g, delta: [p[0] - g.start[0], p[1] - g.start[1]] });
    else if (g.kind === "stroke") {
      if (draw.shape !== "pen") setGesture({ kind: "stroke", points: [g.points[0], p] });
      else {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minSize) setGesture({ kind: "stroke", points: [...g.points, p] });
      }
    } else if (!pending.current) {
      pending.current = true;
      const from = g.from;
      void getEngine()
        .select(tab.id, page, from, p)
        .then((sel: { rects: Rect[] }) => setGesture((cur) => (cur?.kind === "markup" && cur.from === from ? { ...cur, rects: sel.rects } : cur)))
        .finally(() => (pending.current = false));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture;
    if (!g) return;
    setGesture(null);
    const p = pagePoint(e);
    const moved = (d: Point) => Math.hypot(d[0], d[1]) >= minSize;
    const sel = { tabId: tab.id, page, id: g.kind === "move" || g.kind === "resize" ? g.annot.id : 0 };
    if (g.kind === "move") {
      if (moved(g.delta)) void moveAnnot(sel, g.delta[0], g.delta[1]);
    } else if (g.kind === "resize") {
      if (moved(g.delta)) void resizeAnnot(sel, resizeBox(g.annot.box ?? g.annot.rect, g.delta, g.annot.kind === "stamp"));
    } else if (g.kind === "markup") {
      if (moved([p[0] - g.from[0], p[1] - g.from[1]])) void addAnnot(tab.id, page, { kind: markup.kind, from: g.from, to: p, color: markup.colors[markup.kind] });
    } else {
      const points = draw.shape === "pen" ? [...g.points, p] : [g.points[0], p];
      const spec = drawSpec(draw, points, minSize);
      if (spec) void addAnnot(tab.id, page, spec);
    }
  };

  // Frame of the selected annotation, following an in-progress move/resize.
  let frame: Rect | null = null;
  if (current) {
    const g = gesture?.kind === "move" || gesture?.kind === "resize" ? gesture : null;
    const pageRect =
      g?.kind === "move" ? shiftRect(current.rect, g.delta) : g?.kind === "resize" ? resizeBox(current.box ?? current.rect, g.delta, current.kind === "stamp") : current.rect;
    frame = transform.rectToDisplay(pageRect);
  }

  const creating = tool === "comment" || tool === "markup" || tool === "draw" || tool === "sign";
  const stroke = gesture?.kind === "stroke" ? gesture.points : null;
  const strokeStyle = { stroke: cssColor(draw.color), strokeWidth: draw.width * tab.zoom, fill: "none" };
  const ghost = tool === "sign" && hover && signature ? transform.rectToDisplay(fitSignature(hover, SIGNATURE_WIDTH, signature.width / signature.height)) : null;

  return (
    <div ref={layer} className={`annot-layer tool-${tool}`} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
      <svg className="annot-svg" width={transform.width} height={transform.height}>
        {tool === "select" && annots.map((a) => <AnnotHit key={a.id} annot={a} transform={transform} onPointerDown={onAnnotDown(a, "move")} />)}
        {frame && <rect className="annot-frame" x={frame[0]} y={frame[1]} width={frame[2] - frame[0]} height={frame[3] - frame[1]} />}
        {gesture?.kind === "markup" &&
          gesture.rects.map((r, i) => {
            const [x0, y0, x1, y1] = transform.rectToDisplay(r);
            return <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={cssColor(markup.colors[markup.kind], 0.35)} />;
          })}
        {stroke && draw.shape === "pen" && <polyline points={pointsAttr(stroke, transform)} style={strokeStyle} />}
        {stroke && (draw.shape === "line" || draw.shape === "arrow") && <polyline points={pointsAttr([stroke[0], stroke[stroke.length - 1]], transform)} style={strokeStyle} />}
        {stroke &&
          (draw.shape === "rect" || draw.shape === "oval") &&
          (() => {
            const [x0, y0, x1, y1] = transform.rectToDisplay(dragRect(stroke[0], stroke[stroke.length - 1]));
            return draw.shape === "rect" ? (
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} style={strokeStyle} />
            ) : (
              <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} style={strokeStyle} />
            );
          })()}
      </svg>
      {creating && <div className="annot-capture" onPointerDown={onCaptureDown} />}
      {ghost && signature && <img className="signature-ghost" src={signature.png} alt="" style={{ left: ghost[0], top: ghost[1], width: ghost[2] - ghost[0], height: ghost[3] - ghost[1] }} />}
      {current && frame && tool === "select" && current.resizable && (
        <div className="edit-handle annot-handle" style={{ left: frame[2] - 6, top: frame[3] - 6 }} onPointerDown={onAnnotDown(current, "resize")} />
      )}
      {current && frame && tool === "select" && !gesture && <AnnotCard annot={current} tab={tab} anchor={frame} pageWidth={transform.width} />}
    </div>
  );
}
```


- [ ] **Step 6: Wire into `PageSlot.tsx` and shortcuts**

`src/viewer/PageSlot.tsx`: import `AnnotationLayer`; in `onPointerDown` (text selection) add as the first line after the tool check: `appStore.getState().selectAnnot(null);`; after the `page-overlay` div add:

```tsx
      {!editMode && <AnnotationLayer tab={tab} page={slot.page} transform={transform} />}
```

`src/app/useShortcuts.ts`: import `deleteSelectedAnnot` from `./annot-actions`; after the existing Edit-mode Delete block add:

```ts
      if ((e.key === "Delete" || e.key === "Backspace") && s.selectedAnnot) {
        e.preventDefault();
        void deleteSelectedAnnot();
        return;
      }
```

and extend the Escape branch:

```ts
      } else if (e.key === "Escape") {
        s.setSelection(tab.id, null);
        s.setSearchOpen(false);
        if (s.selectedAnnot) s.selectAnnot(null);
        else if (!s.editMode && s.tool !== "select" && s.tool !== "hand") s.setTool("select");
      }
```

- [ ] **Step 7: CSS** — append to `src/app/app.css`:

```css
.annot-layer { position: absolute; inset: 0; pointer-events: none; }
.annot-svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.annot-hit { pointer-events: all; fill: transparent; cursor: pointer; }
.annot-hit.stroke polyline { fill: none; stroke: transparent; pointer-events: stroke; }
.annot-frame { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
.annot-capture { position: absolute; inset: 0; pointer-events: auto; cursor: crosshair; }
.annot-layer.tool-comment .annot-capture { cursor: copy; }
.annot-handle { pointer-events: auto; }
.signature-ghost { position: absolute; opacity: 0.7; pointer-events: none; }
.annot-card {
  position: absolute; z-index: 4; display: flex; flex-direction: column; gap: 6px; padding: 10px; pointer-events: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow);
}
.annot-card-head { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.annot-card textarea {
  width: 100%; box-sizing: border-box; resize: vertical; padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  font-family: "Noto Sans", "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif; font-size: 13px;
}
.annot-card-actions { display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 8: Run tests, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "feat(viewer): annotation layer — select, move, resize, draw, highlight, notes and comment card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Comments panel

**Files:**
- Create: `src/app/CommentsPanel.tsx`
- Modify: `src/app/LeftPanel.tsx`, `src/app/app.css`
- Test: `src/app/CommentsPanel.test.tsx`

**Interfaces:**
- Consumes: `engine.listAnnotations(docId)` (Task 2), `KIND_LABEL`/`KIND_ICON` (Task 7), store (Task 3).
- Produces: `<CommentsPanel tab />`; `LeftPanel` rail button "Comments".

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Annot } from "../edit/types";
import { appStore, getTab } from "../state/store";
import { CommentsPanel } from "./CommentsPanel";

const base: Omit<Annot, "id" | "page" | "kind" | "contents" | "author"> = {
  subtype: "Text", rect: [0, 0, 10, 10], box: null, color: null, modified: null, movable: true, resizable: false,
};
const list: Annot[] = [
  { ...base, id: 3, page: 0, kind: "note", contents: "කොළඹ", author: "Leo" },
  { ...base, id: 9, page: 1, kind: "highlight", subtype: "Highlight", contents: "", author: "" },
];
const engine = vi.hoisted(() => ({ listAnnotations: vi.fn(async () => [] as Annot[]) }));
vi.mock("../engine/client", () => ({ getEngine: () => engine }));

let tabId: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en", tool: "draw", selectedAnnot: null, author: "Leo" });
  tabId = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(tabId, {
    status: "ok",
    info: { pageCount: 2, pages: [{ bounds: [0, 0, 600, 800], label: "1" }, { bounds: [0, 0, 600, 800], label: "ii" }], outline: [], title: null, repaired: false, editable: true, signed: false, annotatable: true },
  });
});
afterEach(cleanup);
const tab = () => getTab(appStore.getState(), tabId)!;

test("lists annotations by page and jumps to one on click", async () => {
  engine.listAnnotations.mockResolvedValueOnce(list);
  render(<CommentsPanel tab={tab()} />);
  expect(await screen.findByText("කොළඹ")).toBeTruthy();
  expect(screen.getByText("Page ii")).toBeTruthy();
  fireEvent.click(screen.getByText("Highlight"));
  expect(appStore.getState()).toMatchObject({ tool: "select", selectedAnnot: { tabId, page: 1, id: 9 } });
  expect(tab().currentPage).toBe(1);
});

test("shows an empty state and edits the author name", async () => {
  engine.listAnnotations.mockResolvedValueOnce([]);
  render(<CommentsPanel tab={tab()} />);
  await waitFor(() => expect(screen.getByText("No comments yet")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "යාපනය" } });
  expect(appStore.getState().author).toBe("යාපනය");
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/app/CommentsPanel.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `src/app/CommentsPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getEngine } from "../engine/client";
import type { Annot } from "../edit/types";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import { KIND_ICON, KIND_LABEL } from "./annot-labels";

/** Every comment and markup in the document, grouped by page (Acrobat's Comments pane). */
export function CommentsPanel({ tab }: { tab: DocTab }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const author = useApp((s) => s.author);
  const [annots, setAnnots] = useState<Annot[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getEngine()
      .listAnnotations(tab.id)
      .then((list: Annot[]) => !cancelled && setAnnots(list));
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.revision]);

  const open = (a: Annot) => {
    const s = appStore.getState();
    s.goToPage(tab.id, a.page);
    s.setTool("select");
    s.selectAnnot({ tabId: tab.id, page: a.page, id: a.id });
  };
  const pages = [...new Set((annots ?? []).map((a) => a.page))].sort((a, b) => a - b);

  return (
    <div className="panel comments">
      <label className="comments-name">
        {t("yourName")}
        <input value={author ?? ""} onChange={(e) => appStore.getState().setAuthor(e.target.value)} />
      </label>
      {annots?.length === 0 && <p className="muted panel-empty">{t("noComments")}</p>}
      {pages.map((page) => (
        <section key={page}>
          <h3 className="comments-page">{t("pageLabel", { label: tab.info!.pages[page].label })}</h3>
          <ul className="comments-list">
            {annots!
              .filter((a) => a.page === page)
              .map((a) => {
                const Icon = KIND_ICON[a.kind];
                return (
                  <li key={a.id}>
                    <button className="comment-item" onClick={() => open(a)}>
                      <Icon size={14} aria-hidden />
                      <span className="comment-body">
                        <span className="comment-meta muted">
                          {a.author || t("unknownAuthor")}
                          {a.modified ? ` · ${new Date(a.modified).toLocaleDateString(lang)}` : ""}
                        </span>
                        <span className="comment-text">{a.contents || t(KIND_LABEL[a.kind])}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: LeftPanel tab** — in `src/app/LeftPanel.tsx` import `MessageSquare` and `CommentsPanel`; add after the Bookmarks rail button:

```tsx
        <button className={`icon-button ${panel === "comments" ? "pressed" : ""}`} aria-label={t("comments")} title={t("comments")} onClick={() => toggle("comments")}>
          <MessageSquare size={18} />
        </button>
```

and after the bookmarks panel block: `{panel === "comments" && <CommentsPanel tab={tab} />}`.

- [ ] **Step 5: CSS** — append:

```css
.comments { display: flex; flex-direction: column; gap: 8px; width: 240px; }
.comments-name { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.comments-name input { height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.comments-page { margin: 8px 0 4px; font-size: 12px; font-weight: 600; }
.comments-list { list-style: none; margin: 0; padding: 0; }
.comment-item { display: flex; gap: 8px; width: 100%; padding: 6px; border: none; border-radius: 6px; background: none; cursor: pointer; text-align: left; color: inherit; }
.comment-item:hover { background: var(--accent-soft); }
.comment-body { display: flex; flex-direction: column; min-width: 0; }
.comment-meta { font-size: 11px; }
.comment-text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: pre-wrap; }
```

- [ ] **Step 6: Run tests, typecheck** — `npx vitest run && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(app): Comments panel with author name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Signature image helpers (pure)

**Files:**
- Create: `src/sign/signature-image.ts`
- Test: `src/sign/signature-image.test.ts`

**Interfaces:**
- Produces: `interface Pixels { width: number; height: number; data: Uint8ClampedArray }` (structurally compatible with `ImageData`), `whitenToTransparent(px: Pixels, threshold?: number): void`, `inkBounds(px: Pixels, pad?: number): Rect | null`.

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "vitest";
import { inkBounds, whitenToTransparent, type Pixels } from "./signature-image";

function pixels(width: number, height: number, fill: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}
const set = (px: Pixels, x: number, y: number, rgba: [number, number, number, number]) => px.data.set(rgba, (y * px.width + x) * 4);

test("near-white pixels become transparent; ink stays", () => {
  const px = pixels(4, 1, [250, 250, 250, 255]);
  set(px, 1, 0, [20, 30, 120, 255]);
  set(px, 2, 0, [200, 200, 200, 255]); // light grey paper shadow stays (below threshold)
  whitenToTransparent(px);
  expect([px.data[3], px.data[7], px.data[11], px.data[15]]).toEqual([0, 255, 255, 0]);
});

test("ink bounds are padded, clamped, and null for an empty pad", () => {
  const px = pixels(100, 50, [0, 0, 0, 0]);
  expect(inkBounds(px)).toBeNull();
  set(px, 10, 20, [0, 0, 0, 255]);
  set(px, 40, 30, [0, 0, 0, 255]);
  expect(inkBounds(px, 4)).toEqual([6, 16, 45, 35]);
  set(px, 99, 49, [0, 0, 0, 255]);
  expect(inkBounds(px, 4)).toEqual([6, 16, 100, 50]);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/sign/signature-image.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Rect } from "../engine/types";

/** RGBA pixels (same shape as the browser's ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Makes near-white pixels transparent (for photographed or scanned signatures). */
export function whitenToTransparent(px: Pixels, threshold = 0.9): void {
  const { data } = px;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    if (luminance >= threshold) data[i + 3] = 0;
  }
}

/** Bounding box [x0, y0, x1, y1) of visible ink, grown by `pad` and clamped to the image; null if there is none. */
export function inkBounds(px: Pixels, pad = 8): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      if (px.data[(y * px.width + x) * 4 + 3] <= 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(px.width, x1 + 1 + pad), Math.min(px.height, y1 + 1 + pad)];
}
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sign
git commit -m "feat(sign): trim and whiten signature images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Signature dialog (draw, type, image)

**Files:**
- Create: `src/sign/render-signature.ts`, `src/sign/SignatureDialog.tsx`
- Modify: `src/viewer/InlineTextEditor.tsx` (export `FAMILIES`), `src/app/App.tsx`, `src/app/app.css`
- Test: `src/sign/SignatureDialog.test.tsx`

**Interfaces:**
- Consumes: `inkBounds`, `whitenToTransparent` (Task 9), `SavedSignature` (Task 3), store `addSignature`/`setDialog`/`showNotice`, `pickImage` (`src/platform/files.ts`), `FAMILIES` (`InlineTextEditor.tsx`).
- Produces: `PAD_WIDTH = 480`, `PAD_HEIGHT = 160`, `prepareCanvas(canvas): CanvasRenderingContext2D`, `drawStrokes(ctx, strokes, color)`, `drawTyped(ctx, text, family, color, cancelled): Promise<void>`, `drawImage(ctx, bytes, whiten, cancelled): Promise<void>`, `exportSignature(canvas, id?): SavedSignature | null`; `<SignatureDialog />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appStore } from "../state/store";
import { SignatureDialog } from "./SignatureDialog";

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never; // jsdom has no canvas
  appStore.setState({ lang: "en", dialog: { kind: "signature" }, signatures: [] });
});
afterEach(cleanup);

test("the dialog offers Draw, Type and Image; Save waits for content", () => {
  render(<SignatureDialog />);
  expect(screen.getByRole("tab", { name: "Draw" }).getAttribute("aria-selected")).toBe("true");
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Type" }));
  fireEvent.change(screen.getByLabelText("Type your name"), { target: { value: "ශ්‍රී ලංකා" } });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("tab", { name: "Image" }));
  expect(screen.getByRole("button", { name: "Choose image…" })).toBeTruthy();
  expect((screen.getByLabelText("Remove white background") as HTMLInputElement).checked).toBe(true);
});

test("Cancel closes the dialog without saving", () => {
  render(<SignatureDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(appStore.getState()).toMatchObject({ dialog: null, signatures: [] });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/sign/SignatureDialog.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `src/sign/render-signature.ts`**

In `src/viewer/InlineTextEditor.tsx` change `const FAMILIES = {` to `export const FAMILIES = {`.

```ts
import type { Point } from "../engine/types";
import type { SavedSignature } from "../platform/prefs";
import { FAMILIES } from "../viewer/InlineTextEditor";
import { inkBounds, whitenToTransparent } from "./signature-image";

/** Signature pad size in CSS pixels; the canvas is 2× for sharp output. */
export const PAD_WIDTH = 480;
export const PAD_HEIGHT = 160;
const SCALE = 2;

export function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  canvas.width = PAD_WIDTH * SCALE;
  canvas.height = PAD_HEIGHT * SCALE;
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  return ctx;
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    if (stroke.length === 1) ctx.lineTo(stroke[0][0] + 0.1, stroke[0][1]);
    ctx.stroke();
  }
}

/** Typed name in the bundled Noto fonts; the browser shapes Sinhala and Tamil. */
export async function drawTyped(ctx: CanvasRenderingContext2D, text: string, family: keyof typeof FAMILIES, color: string, cancelled: () => boolean): Promise<void> {
  if (!text.trim()) return;
  let size = 64;
  await document.fonts.load(`${size}px ${FAMILIES[family]}`, text);
  if (cancelled()) return;
  ctx.font = `${size}px ${FAMILIES[family]}`;
  while (size > 16 && ctx.measureText(text).width > PAD_WIDTH - 24) {
    size -= 4;
    ctx.font = `${size}px ${FAMILIES[family]}`;
  }
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, PAD_HEIGHT / 2);
}

/** A picked PNG/JPEG, fitted into the pad; optionally with its white background removed. Throws if unreadable. */
export async function drawImage(ctx: CanvasRenderingContext2D, bytes: Uint8Array, whiten: boolean, cancelled: () => boolean): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  if (cancelled()) return;
  const scale = Math.min(PAD_WIDTH / bitmap.width, PAD_HEIGHT / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (PAD_WIDTH - w) / 2, (PAD_HEIGHT - h) / 2, w, h);
  if (whiten) {
    const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    whitenToTransparent(data);
    ctx.putImageData(data, 0, 0);
  }
}

/** Crops the pad to the ink and returns it as a PNG signature, or null if the pad is empty. */
export function exportSignature(canvas: HTMLCanvasElement, id = crypto.randomUUID()): SavedSignature | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const box = inkBounds(data);
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const out = document.createElement("canvas");
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext("2d")!.putImageData(data, -x0, -y0);
  return { id, png: out.toDataURL("image/png"), width: out.width, height: out.height };
}
```

- [ ] **Step 4: Implement `src/sign/SignatureDialog.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { Point } from "../engine/types";
import type { StringKey } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { pickImage } from "../platform/files";
import { appStore, useApp } from "../state/store";
import { PAD_HEIGHT, PAD_WIDTH, drawImage, drawStrokes, drawTyped, exportSignature, prepareCanvas } from "./render-signature";

type Mode = "draw" | "type" | "image";
const MODES: { mode: Mode; label: StringKey }[] = [
  { mode: "draw", label: "signDraw" },
  { mode: "type", label: "signType" },
  { mode: "image", label: "signImage" },
];
const INKS = { black: "#111111", blue: "#1d3a8a" };

export function SignatureDialog() {
  const dialog = useApp((s) => s.dialog);
  return dialog?.kind === "signature" ? <SignaturePad /> : null;
}

function SignaturePad() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("draw");
  const [ink, setInk] = useState<keyof typeof INKS>("black");
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [name, setName] = useState("");
  const [family, setFamily] = useState<"sans" | "serif">("serif");
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [whiten, setWhiten] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const ctx = canvas.current && prepareCanvas(canvas.current);
    if (!ctx) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    if (mode === "draw") drawStrokes(ctx, strokes, INKS[ink]);
    else if (mode === "type") void drawTyped(ctx, name, family, INKS[ink], isCancelled);
    else if (image)
      void drawImage(ctx, image, whiten, isCancelled).catch(() => {
        if (cancelled) return;
        setImage(null);
        appStore.getState().showNotice("imageUnreadable");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, strokes, name, family, image, whiten, ink]);

  const padPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - box.left) * PAD_WIDTH) / (box.width || PAD_WIDTH), ((e.clientY - box.top) * PAD_HEIGHT) / (box.height || PAD_HEIGHT)];
  };
  const ready = mode === "draw" ? strokes.length > 0 : mode === "type" ? name.trim().length > 0 : image !== null;
  const close = () => appStore.getState().setDialog(null);
  const save = () => {
    const sig = canvas.current && exportSignature(canvas.current);
    if (!sig) return;
    const s = appStore.getState();
    const dropped = s.addSignature(sig);
    s.setDialog(null);
    if (dropped) s.showNotice("signatureDropped");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("signatureTitle")}>
      <div className="doc-message signature-dialog">
        <h2>{t("signatureTitle")}</h2>
        <div className="segmented" role="tablist">
          {MODES.map((m) => (
            <button key={m.mode} role="tab" aria-selected={mode === m.mode} className={mode === m.mode ? "pressed" : ""} onClick={() => setMode(m.mode)}>
              {t(m.label)}
            </button>
          ))}
        </div>
        {mode === "type" && (
          <div className="signature-controls">
            <input aria-label={t("typeYourName")} placeholder={t("typeYourName")} value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label={t("fontFamily")} value={family} onChange={(e) => setFamily(e.target.value as "sans" | "serif")}>
              <option value="serif">Noto Serif</option>
              <option value="sans">Noto Sans</option>
            </select>
          </div>
        )}
        {mode === "image" && (
          <div className="signature-controls">
            <button onClick={() => void pickImage().then((bytes) => bytes && setImage(bytes))}>{t("chooseImage")}</button>
            <label>
              <input type="checkbox" checked={whiten} onChange={(e) => setWhiten(e.target.checked)} /> {t("removeWhite")}
            </label>
          </div>
        )}
        <canvas
          ref={canvas}
          className={`signature-pad mode-${mode}`}
          style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
          onPointerDown={(e) => {
            if (mode !== "draw") return;
            drawing.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const p = padPoint(e);
            setStrokes((s) => [...s, [p]]);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = padPoint(e);
            setStrokes((s) => [...s.slice(0, -1), [...s[s.length - 1], p]]);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <div className="signature-controls">
          {mode !== "image" && (
            <div className="swatches" role="group" aria-label={t("inkColor")}>
              {(Object.keys(INKS) as (keyof typeof INKS)[]).map((k) => (
                <button key={k} className={`swatch ${ink === k ? "pressed" : ""}`} style={{ background: INKS[k] }} aria-label={INKS[k]} aria-pressed={ink === k} onClick={() => setInk(k)} />
              ))}
            </div>
          )}
          {mode === "draw" && <button onClick={() => setStrokes([])}>{t("clear")}</button>}
          <span className="muted">{t("signatureHint")}</span>
        </div>
        <div className="form-actions">
          <button onClick={close}>{t("cancel")}</button>
          <button className="primary-button" disabled={!ready} onClick={save}>
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire into App and style**

`src/app/App.tsx`: import `SignatureDialog` from `../sign/SignatureDialog`; render `<SignatureDialog />` after `<AuthorDialog />`.

Append to `src/app/app.css`:

```css
.signature-dialog { width: min(540px, 92vw); max-width: none; display: flex; flex-direction: column; gap: 10px; }
.segmented { display: inline-flex; align-self: flex-start; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.segmented button { padding: 6px 14px; border: none; background: var(--panel); color: inherit; cursor: pointer; }
.segmented button.pressed { background: var(--accent-soft); color: var(--accent); }
.signature-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.signature-controls input:not([type]) { flex: 1; height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.signature-controls button:not(.swatch) { padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); cursor: pointer; }
.signature-pad { width: 100%; border: 1px dashed var(--border); border-radius: 8px; background: #fff; touch-action: none; }
.signature-pad.mode-draw { cursor: crosshair; }
```

- [ ] **Step 6: Run tests, typecheck, build** — `npx vitest run && npx tsc --noEmit && npx vite build` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "feat(sign): create signatures by drawing, typing (Sinhala/Tamil shaped) or importing an image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verification, docs and PR

**Files:**
- Modify: `README.md` (feature list)

- [ ] **Step 1: Full checks**

Run: `npx vitest run && npx tsc --noEmit && npx vite build && (cd src-tauri && cargo test)`
Expected: all pass.

- [ ] **Step 2: Browser check (dev server, `.claude/launch.json` "web")**

Start the preview, open `tests/fixtures/sample-si-ta.pdf` (drop it via a `DataTransfer` script as in E1's verification), then check, with screenshots:
1. Rail shows Select, Comment, Highlight, Draw, Add text, Sign, Edit PDF; the author dialog appears on the first annotation tool.
2. Highlight the English, Sinhala and Tamil lines; underline and strike one; colours change from the card.
3. Place a note, type "ශ්‍රී ලංකාව — யாழ்ப்பாணம்", click away, reopen the card: the text is there; the Comments panel lists it under "Page 1".
4. Draw pen, line, arrow, rectangle, oval; move the rectangle; resize the oval; delete the arrow with the Delete key.
5. Sign: create a signature each way (draw; type in Sinhala; image), place it, resize it (aspect kept).
6. ⌘Z/⇧⌘Z step through all of it; the dirty dot shows; Save downloads a PDF that reopens with every annotation.
7. Rotate the view 90° and place a note: it lands under the pointer.

- [ ] **Step 3: README** — in the feature list add: "Comment, highlight/underline/strikethrough, draw and sign (visual signatures) — saved as standard PDF annotations that Acrobat can read." Commit:

```bash
git add README.md
git commit -m "docs: mention annotations and signatures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final whole-branch review** (fresh reviewer on the most capable model), fix findings, re-run Step 1.

- [ ] **Step 5: Push, Windows build, PR**

```bash
git push -u origin feat/annotations
gh workflow run build.yml --ref feat/annotations -f platform=windows
gh pr create --title "Annotations & tool rail: highlight, comments, draw, sign" --body-file <body>
```

PR body: summary, test plan, manual checks still pending (Acrobat/Preview verification of saved annotations, native-speaker review of new si/ta strings), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
