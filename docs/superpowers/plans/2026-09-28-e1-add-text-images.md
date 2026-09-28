# LeoPDF E1 (Add Text & Images) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Acrobat-style Edit mode that adds, edits, moves and deletes correctly shaped English/Sinhala/Tamil text boxes and images (including existing images), with undo/redo and safe Save/Save As.

**Architecture:** Editing runs in the engine worker. Text is split by script, shaped with HarfBuzz using bundled Noto fonts, and written as PDF text (Type0/Identity-H fonts, `TJ` runs, per-cluster `/ActualText`, custom `/ToUnicode`). Each LeoPDF-added item lives in its own content stream tagged `/LeoPDF` with metadata on the page, so it can be moved/edited/deleted later. MuPDF's journal gives undo/redo. The UI adds an Edit toggle, an edit bar, an overlay layer per page with frames and an inline text editor, and unsaved-changes guards. Rust gains an atomic `write_file`.

**Tech Stack:** existing (Tauri 2, React 19, TS, Vite 8, Vitest 5, mupdf.js 1.28) + `harfbuzzjs` 1.6, `@expo-google-fonts/noto-{sans,serif}{,-sinhala,-tamil}` (TTF, OFL), `@fontsource/noto-serif*` (UI editor fonts), Rust `percent-encoding`.

**Spec:** `docs/superpowers/specs/2026-09-28-editing-design.md` (sections 2, 3 "Edit mode" + "E1", 4, 6, 7, 8 "E1 build").

## Global Constraints

- AGPL-3.0-or-later; offline; no telemetry.
- All user-facing strings through `translate()` in en/si/ta.
- UI never imports `mupdf` or `harfbuzzjs`; only `src/engine/*` and `src/edit/*` (worker side) do.
- Fonts: Noto Sans / Noto Serif × Regular / Bold for Latin, Sinhala, Tamil — from `@expo-google-fonts/*` TTFs, paths `node_modules/@expo-google-fonts/<pkg>/<400Regular|700Bold>/<Name>_<400Regular|700Bold>.ttf`.
- Written text must carry one `/Span <</ActualText …>> BDC … EMC` per HarfBuzz cluster and a `/ToUnicode` CMap maintained by LeoPDF.
- Test strings use Sri Lankan content only (e.g. ශ්‍රී ලංකාව, කොළඹ, යාපනය, யாழ்ப்பாணம், கொழும்பு) — never "தமிழ் நாடு".
- Saving never overwrites the original non-atomically; a failed save leaves the original untouched and the tab dirty.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Mixed-script strings with punctuation/digits/joiners at run boundaries** (`ශ්‍රී ලංකා (2026), யாழ்ப்பாணம்!`) must pick the right font per character, show no notdef boxes, and extract exactly. Tests: Task 1 (`scripts.test.ts`), Task 3 (round-trip corpus).
2. **Rotated pages (`/Rotate 90`) and non-zero MediaBox origins** must place added text/images upright at the clicked point. Test: Task 4 (`page-objects.test.ts` "rotated page").
3. **Undo of the edit that first embedded a font, then more edits, then save** must not leave dangling font resources; the saved file must reopen with the text intact. Test: Task 6 (`editor.test.ts` "undo after font embed").
4. **Save to a failing path** (missing directory / read-only) leaves the original untouched, no temp file, tab still dirty. Tests: Task 7 (Rust) and Task 10 (`edit-actions.test.ts` "save failure").
5. **Pages sharing one Resources dictionary** (common in generated PDFs): editing page 1 must not change page 2's resources or content. Test: Task 4 ("shared resources").

---

## File Structure

```
src/edit/                       worker-side editing (may import mupdf/harfbuzzjs)
  types.ts                      TextStyle, PageObject, ExistingImage, HistoryState, EditResult
  scripts.ts                    splitScripts(): script runs (Latin / Sinhala / Tamil)
  fonts.ts                      FontKey, fontKey(), fontFile() (package paths)
  font-urls.ts                  browser FontSource (Vite ?url imports + fetch)
  node-font-source.ts           Node FontSource for tests (reads node_modules)
  font-registry.ts              FontRegistry / LoadedFont (hb + mupdf font, cached)
  shaper.ts                     shapeRun / shapeLine / shapeText / loadStyleFonts
  text-writer.ts                pure: shaped lines → PDF text content (TJ, ActualText)
  embedded-fonts.ts             per-document font embedding + ToUnicode maintenance
  page-space.ts                 page↔PDF matrices, own resources, content wrapping
  page-objects.ts               LeoPDF objects: add/update/move/resize/delete text & images
  existing-images.ts            list / delete / replace / convert images already in the PDF
  editor.ts                     DocumentEditor: journal ops, history, save
src/engine/document-engine.ts   (modify) editable/signed info, edit entry points, cache invalidation
src/engine/engine-api.ts        (modify) expose edit methods
src/engine/lazy-api.ts          (modify) method list derived from the API
src/engine/worker.ts            (modify) browser font source
src/platform/files.ts           writePdf, pickSavePath, downloadPdf, pickImage, ensurePdfName
src-tauri/src/lib.rs            (modify) write_file (atomic, raw body), read_image
src/i18n/strings.ts             (modify) editing strings
src/state/store.ts              (modify) edit mode, tool, style, tab dirty/history/revision, dialogs, notices
src/app/edit-actions.ts         edit orchestration + save flow + close/quit guards
src/app/EditBar.tsx             edit toolbar
src/app/Toolbar.tsx             (modify) Edit toggle
src/app/useShortcuts.ts         (modify) undo/redo/save/delete
src/app/ConfirmDialog.tsx       generic 3-button dialog (unsaved changes, signed warning)
src/app/App.tsx                 (modify) EditBar, dialogs, notices, quit guard
src/viewer/EditLayer.tsx        frames, drag/resize, click-to-add, inline editor host
src/viewer/InlineTextEditor.tsx textarea editor positioned on the page
src/viewer/PageSlot.tsx         (modify) EditLayer in edit mode
src/viewer/PageCanvas.tsx       (modify) re-render on revision
scripts/pdfkit-check.swift      measures extraction in macOS PDFKit (manual/CI-optional)
```

---

### Task 1: Fonts and script splitting

**Files:**
- Create: `src/edit/scripts.ts`, `src/edit/fonts.ts`, `src/edit/font-registry.ts`, `src/edit/node-font-source.ts`, `src/edit/font-urls.ts`
- Modify: `package.json` (deps), `vite.config.ts` (`optimizeDeps.exclude` add `harfbuzzjs`)
- Test: `src/edit/scripts.test.ts`, `src/edit/font-registry.test.ts`

**Interfaces:**
- Produces: `Script = "latin" | "sinhala" | "tamil"`, `ScriptRun { script; text; start }`, `scriptOf(ch)`, `splitScripts(text, hasGlyph?)`; `Family = "sans" | "serif"`, `FontKey`, `fontKey(script, family, bold)`, `fontFile(key)`, `ALL_FONT_KEYS`; `FontSource = (key: FontKey) => Promise<Uint8Array>`; `LoadedFont { key; bytes; upem; hbFont; mu; hasChar(ch); defaultAdvance(gid) }`; `FontRegistry.get(key): Promise<LoadedFont>`; `nodeFontSource`; `fetchFontSource`.

- [ ] **Step 1: Install dependencies**

```bash
npm i harfbuzzjs @expo-google-fonts/noto-sans @expo-google-fonts/noto-serif @expo-google-fonts/noto-sans-sinhala @expo-google-fonts/noto-serif-sinhala @expo-google-fonts/noto-sans-tamil @expo-google-fonts/noto-serif-tamil @fontsource/noto-serif @fontsource/noto-serif-sinhala @fontsource/noto-serif-tamil
```
In `vite.config.ts` set `optimizeDeps: { exclude: ["mupdf", "harfbuzzjs"] }`.

- [ ] **Step 2: Write failing script-splitting tests**

`src/edit/scripts.test.ts`:
```ts
import { expect, test } from "vitest";
import { scriptOf, splitScripts } from "./scripts";

test("scriptOf classifies letters and leaves neutrals unassigned", () => {
  expect(scriptOf("ක")).toBe("sinhala");
  expect(scriptOf("யா")).toBe("tamil");
  expect(scriptOf("A")).toBe("latin");
  expect(scriptOf("7")).toBe("latin");
  expect(scriptOf(" ")).toBeNull();
  expect(scriptOf("‍")).toBeNull();
  expect(scriptOf(",")).toBeNull();
});

test("single-script text with ZWJ is one run", () => {
  expect(splitScripts("ශ්‍රී ලංකාව")).toEqual([{ script: "sinhala", text: "ශ්‍රී ලංකාව", start: 0 }]);
});

test("mixed text splits by script; spaces stay with the run before them", () => {
  const text = "Colombo කොළඹ யாழ்ப்பாணம்";
  expect(splitScripts(text)).toEqual([
    { script: "latin", text: "Colombo ", start: 0 },
    { script: "sinhala", text: "කොළඹ ", start: text.indexOf("ක") },
    { script: "tamil", text: "யாழ்ப்பாணம்", start: text.indexOf("யா") },
  ]);
});

test("punctuation a script font lacks moves to a Latin run", () => {
  const hasGlyph = (script: string, ch: string) => script === "latin" || !/[(),!]/.test(ch);
  const text = "ශ්‍රී ලංකා (2026), யாழ்ப்பாணம்!";
  expect(splitScripts(text, hasGlyph)).toEqual([
    { script: "sinhala", text: "ශ්‍රී ලංකා ", start: 0 },
    { script: "latin", text: "(2026), ", start: text.indexOf("(") },
    { script: "tamil", text: "யாழ்ப்பாணம்", start: text.indexOf("யா") },
    { script: "latin", text: "!", start: text.indexOf("!") },
  ]);
});

test("leading neutrals join the first run when its font has them", () => {
  expect(splitScripts("  කොළඹ")).toEqual([{ script: "sinhala", text: "  කොළඹ", start: 0 }]);
  const noParen = (script: string, ch: string) => script === "latin" || ch !== "(";
  expect(splitScripts("(කොළඹ", noParen)).toEqual([
    { script: "latin", text: "(", start: 0 },
    { script: "sinhala", text: "කොළඹ", start: 1 },
  ]);
});

test("text with only neutrals is a Latin run; empty text has no runs", () => {
  expect(splitScripts(" , ")).toEqual([{ script: "latin", text: " , ", start: 0 }]);
  expect(splitScripts("")).toEqual([]);
});
```

Run: `npx vitest run src/edit/scripts.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement scripts.ts**

`src/edit/scripts.ts`:
```ts
export type Script = "latin" | "sinhala" | "tamil";

export interface ScriptRun {
  script: Script;
  text: string;
  /** UTF-16 offset of the run in the source text. */
  start: number;
}

const SINHALA = /[඀-෿\u{111E0}-\u{111FF}]/u;
const TAMIL = /[஀-௿\u{11FC0}-\u{11FFF}]/u;
/** Characters that always stay in the current run so shaping keeps working: spaces, joiners, combining marks. */
const STICKY = /[\s‌‍\p{M}]/u;

export function scriptOf(ch: string): Script | null {
  if (SINHALA.test(ch)) return "sinhala";
  if (TAMIL.test(ch)) return "tamil";
  if (/[\p{L}\p{N}]/u.test(ch)) return "latin";
  return null;
}

/**
 * Splits text into runs that each use one script's font. Neutral characters (spaces, joiners,
 * punctuation) stay in the current run if its font has them, otherwise they go to a Latin run.
 */
export function splitScripts(text: string, hasGlyph: (script: Script, ch: string) => boolean = () => true): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let leading = "";
  let offset = 0;
  const push = (script: Script, chunk: string, at: number) => {
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += chunk;
    else runs.push({ script, text: chunk, start: at });
  };
  for (const ch of text) {
    const script = scriptOf(ch);
    const last = runs[runs.length - 1];
    if (script === null) {
      if (!last) leading += ch;
      else if (STICKY.test(ch) || hasGlyph(last.script, ch)) last.text += ch;
      else push("latin", ch, offset);
    } else {
      if (leading) {
        const fits = Array.from(leading).every((c) => STICKY.test(c) || hasGlyph(script, c));
        push(fits ? script : "latin", leading, 0);
        leading = "";
      }
      push(script, ch, offset);
    }
    offset += ch.length;
  }
  if (leading) push("latin", leading, 0);
  return runs;
}
```

Run: `npx vitest run src/edit/scripts.test.ts` → PASS.

- [ ] **Step 4: Font keys, sources and registry — failing test**

`src/edit/font-registry.test.ts`:
```ts
import { expect, test } from "vitest";
import { FontRegistry } from "./font-registry";
import { ALL_FONT_KEYS, fontFile, fontKey } from "./fonts";
import { nodeFontSource } from "./node-font-source";

test("font keys and files cover 3 scripts × 2 families × 2 weights", () => {
  expect(ALL_FONT_KEYS).toHaveLength(12);
  expect(fontKey("sinhala", "serif", true)).toBe("sinhala-serif-bold");
  expect(fontFile("sinhala-serif-bold")).toBe("noto-serif-sinhala/700Bold/NotoSerifSinhala_700Bold.ttf");
  expect(fontFile("latin-sans-regular")).toBe("noto-sans/400Regular/NotoSans_400Regular.ttf");
});

test("every bundled font loads", async () => {
  const registry = new FontRegistry(nodeFontSource);
  for (const key of ALL_FONT_KEYS) {
    const font = await registry.get(key);
    expect(font.upem, key).toBeGreaterThan(0);
  }
});

test("a loaded font knows its characters and advances, and is cached", async () => {
  const registry = new FontRegistry(nodeFontSource);
  const si = await registry.get("sinhala-sans-regular");
  expect(si.hasChar("ක")).toBe(true);
  expect(si.hasChar("யா")).toBe(false);
  const gid = si.mu.encodeCharacter("ක".codePointAt(0)!);
  expect(si.defaultAdvance(gid)).toBeGreaterThan(0);
  expect(await registry.get("sinhala-sans-regular")).toBe(si);
});

test("a failing source is not cached", async () => {
  let calls = 0;
  const registry = new FontRegistry(async (key) => {
    calls++;
    if (calls === 1) throw new Error("network");
    return nodeFontSource(key);
  });
  await expect(registry.get("latin-sans-regular")).rejects.toThrow("network");
  expect((await registry.get("latin-sans-regular")).upem).toBeGreaterThan(0);
});
```

Run: `npx vitest run src/edit/font-registry.test.ts` → FAIL.

- [ ] **Step 5: Implement fonts.ts, node-font-source.ts, font-registry.ts, font-urls.ts**

`src/edit/fonts.ts`:
```ts
import type { Script } from "./scripts";

export type Family = "sans" | "serif";
export type Weight = "regular" | "bold";
export type FontKey = `${Script}-${Family}-${Weight}`;

const NAMES: Record<Script, Record<Family, [pkg: string, file: string]>> = {
  latin: { sans: ["noto-sans", "NotoSans"], serif: ["noto-serif", "NotoSerif"] },
  sinhala: { sans: ["noto-sans-sinhala", "NotoSansSinhala"], serif: ["noto-serif-sinhala", "NotoSerifSinhala"] },
  tamil: { sans: ["noto-sans-tamil", "NotoSansTamil"], serif: ["noto-serif-tamil", "NotoSerifTamil"] },
};

export const ALL_FONT_KEYS: FontKey[] = (["latin", "sinhala", "tamil"] as Script[]).flatMap((s) =>
  (["sans", "serif"] as Family[]).flatMap((f) => (["regular", "bold"] as Weight[]).map((w) => `${s}-${f}-${w}` as FontKey)),
);

export function fontKey(script: Script, family: Family, bold: boolean): FontKey {
  return `${script}-${family}-${bold ? "bold" : "regular"}`;
}

/** Path of the TTF inside node_modules/@expo-google-fonts/. */
export function fontFile(key: FontKey): string {
  const [script, family, weight] = key.split("-") as [Script, Family, Weight];
  const [pkg, name] = NAMES[script][family];
  const dir = weight === "bold" ? "700Bold" : "400Regular";
  return `${pkg}/${dir}/${name}_${dir}.ttf`;
}
```

`src/edit/node-font-source.ts` (tests only):
```ts
import { readFile } from "node:fs/promises";
import type { FontSource } from "./font-registry";
import { fontFile } from "./fonts";

export const nodeFontSource: FontSource = async (key) =>
  new Uint8Array(await readFile(new URL(`../../node_modules/@expo-google-fonts/${fontFile(key)}`, import.meta.url)));
```

`src/edit/font-registry.ts`:
```ts
import * as hb from "harfbuzzjs";
import * as mupdf from "mupdf";
import type { FontKey } from "./fonts";

export type FontSource = (key: FontKey) => Promise<Uint8Array>;

export interface LoadedFont {
  key: FontKey;
  bytes: Uint8Array;
  upem: number;
  hbFont: hb.Font;
  mu: mupdf.Font;
  hasChar(ch: string): boolean;
  /** Advance MuPDF writes into the embedded font's /W array, in font units. */
  defaultAdvance(gid: number): number;
}

function load(key: FontKey, bytes: Uint8Array): LoadedFont {
  const face = new hb.Face(new hb.Blob(bytes));
  const mu = new mupdf.Font(key, bytes);
  const upem = face.upem;
  return {
    key,
    bytes,
    upem,
    hbFont: new hb.Font(face),
    mu,
    hasChar: (ch) => mu.encodeCharacter(ch.codePointAt(0)!) > 0,
    defaultAdvance: (gid) => mu.advanceGlyph(gid) * upem,
  };
}

/** Loads each bundled font once (bytes + HarfBuzz + MuPDF objects). */
export class FontRegistry {
  private fonts = new Map<FontKey, Promise<LoadedFont>>();

  constructor(private readonly source: FontSource) {}

  get(key: FontKey): Promise<LoadedFont> {
    let font = this.fonts.get(key);
    if (!font) {
      font = this.source(key).then((bytes) => load(key, bytes));
      font.catch(() => this.fonts.delete(key));
      this.fonts.set(key, font);
    }
    return font;
  }
}
```

`src/edit/font-urls.ts` (browser/worker):
```ts
import latinSansBold from "@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url";
import latinSansRegular from "@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url";
import latinSerifBold from "@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf?url";
import latinSerifRegular from "@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url";
import sinhalaSansBold from "@expo-google-fonts/noto-sans-sinhala/700Bold/NotoSansSinhala_700Bold.ttf?url";
import sinhalaSansRegular from "@expo-google-fonts/noto-sans-sinhala/400Regular/NotoSansSinhala_400Regular.ttf?url";
import sinhalaSerifBold from "@expo-google-fonts/noto-serif-sinhala/700Bold/NotoSerifSinhala_700Bold.ttf?url";
import sinhalaSerifRegular from "@expo-google-fonts/noto-serif-sinhala/400Regular/NotoSerifSinhala_400Regular.ttf?url";
import tamilSansBold from "@expo-google-fonts/noto-sans-tamil/700Bold/NotoSansTamil_700Bold.ttf?url";
import tamilSansRegular from "@expo-google-fonts/noto-sans-tamil/400Regular/NotoSansTamil_400Regular.ttf?url";
import tamilSerifBold from "@expo-google-fonts/noto-serif-tamil/700Bold/NotoSerifTamil_700Bold.ttf?url";
import tamilSerifRegular from "@expo-google-fonts/noto-serif-tamil/400Regular/NotoSerifTamil_400Regular.ttf?url";
import type { FontSource } from "./font-registry";
import type { FontKey } from "./fonts";

const URLS: Record<FontKey, string> = {
  "latin-sans-regular": latinSansRegular,
  "latin-sans-bold": latinSansBold,
  "latin-serif-regular": latinSerifRegular,
  "latin-serif-bold": latinSerifBold,
  "sinhala-sans-regular": sinhalaSansRegular,
  "sinhala-sans-bold": sinhalaSansBold,
  "sinhala-serif-regular": sinhalaSerifRegular,
  "sinhala-serif-bold": sinhalaSerifBold,
  "tamil-sans-regular": tamilSansRegular,
  "tamil-sans-bold": tamilSansBold,
  "tamil-serif-regular": tamilSerifRegular,
  "tamil-serif-bold": tamilSerifBold,
};

export const fetchFontSource: FontSource = async (key) => {
  const response = await fetch(URLS[key]);
  if (!response.ok) throw new Error(`Font ${key} failed to load (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/edit` → PASS. `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/edit
git commit -m "feat(edit): bundled Noto fonts, font registry and script splitting"
```

---

### Task 2: Text shaper

**Files:**
- Create: `src/edit/types.ts`, `src/edit/shaper.ts`
- Test: `src/edit/shaper.test.ts`

**Interfaces:**
- Consumes: `splitScripts`, `Script` (Task 1); `FontRegistry`, `LoadedFont`, `fontKey`, `Family` (Task 1).
- Produces:
  - `types.ts`: `TextStyle { family: Family; bold: boolean; size: number; color: [number, number, number] }` (colour components 0–1), `PageObject`, `ExistingImage`, `HistoryState`, `EditResult` (definitions below).
  - `ShapedGlyph { gid; advance; dx; dy; cluster }` (points; `cluster` = UTF-16 index into the line text), `ShapedRun { font; text; start; glyphs; width }`, `ShapedLine { text; runs; width; missing: string[] }`.
  - `loadStyleFonts(registry, style): Promise<Record<Script, LoadedFont>>`, `shapeRun(font, text, start, size)`, `shapeLine(text, style, fonts)`, `shapeText(text, style, fonts): ShapedLine[]` (splits on `\n`).

- [ ] **Step 1: Types**

`src/edit/types.ts`:
```ts
import type { Point, Rect } from "../engine/types";
import type { Family } from "./fonts";

export interface TextStyle {
  family: Family;
  bold: boolean;
  /** Font size in points. */
  size: number;
  /** RGB, each 0–1. */
  color: [number, number, number];
}

/** An item LeoPDF added to a page (editable later). Coordinates are page space (y down). */
export interface PageObject {
  id: string;
  kind: "text" | "image";
  rect: Rect;
  text?: string;
  style?: TextStyle;
  /** Baseline start of the first line (text objects). */
  origin?: Point;
}

/** An image that was already in the PDF. */
export interface ExistingImage {
  rect: Rect;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
}

export interface EditResult {
  history: HistoryState;
  /** Id of the object created or changed, if any. */
  id?: string;
  /** Characters that no bundled font can show (rendered as boxes). */
  missing?: string[];
}
```

- [ ] **Step 2: Failing shaper tests**

`src/edit/shaper.test.ts`:
```ts
import * as hb from "harfbuzzjs";
import { expect, test } from "vitest";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { loadStyleFonts, shapeLine, shapeRun, shapeText } from "./shaper";
import type { TextStyle } from "./types";

const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 12, color: [0, 0, 0] };

test("glyph ids match HarfBuzz directly for a Sinhala conjunct", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const run = shapeRun(fonts.sinhala, "ශ්‍රී", 0, 12);
  const buf = new hb.Buffer();
  buf.addText("ශ්‍රී");
  buf.guessSegmentProperties();
  hb.shape(fonts.sinhala.hbFont, buf);
  expect(run.glyphs.map((g) => g.gid)).toEqual(buf.getGlyphInfos().map((g) => g.codepoint));
  expect(run.glyphs.length).toBeLessThan(Array.from("ශ්‍රී").length); // conjunct forms fewer glyphs
});

test("mixed line uses one run per script with clusters indexing the whole line", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const text = "Colombo කොළඹ யாழ்ப்பாணம்";
  const line = shapeLine(text, style, fonts);
  expect(line.runs.map((r) => r.font.key)).toEqual(["latin-sans-regular", "sinhala-sans-regular", "tamil-sans-regular"]);
  expect(Math.min(...line.runs[1].glyphs.map((g) => g.cluster))).toBe(text.indexOf("ක"));
  expect(line.width).toBeCloseTo(line.runs.reduce((w, r) => w + r.width, 0));
  expect(line.missing).toEqual([]);
});

test("width scales with font size", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const small = shapeLine("ශ්‍රී ලංකාව", style, fonts);
  const large = shapeLine("ශ්‍රී ලංකාව", { ...style, size: 24 }, fonts);
  expect(large.width).toBeCloseTo(small.width * 2);
});

test("characters no bundled font has are reported as missing", async () => {
  const fonts = await loadStyleFonts(registry, style);
  expect(shapeLine("කොළඹ 中", style, fonts).missing).toEqual(["中"]);
});

test("shapeText splits lines on newlines", async () => {
  const fonts = await loadStyleFonts(registry, style);
  expect(shapeText("කොළඹ\nயாழ்ப்பாணம்\n", style, fonts).map((l) => l.text)).toEqual(["කොළඹ", "யாழ்ப்பாணம்", ""]);
});
```

Run: `npx vitest run src/edit/shaper.test.ts` → FAIL.

- [ ] **Step 3: Implement shaper.ts**

`src/edit/shaper.ts`:
```ts
import * as hb from "harfbuzzjs";
import type { FontRegistry, LoadedFont } from "./font-registry";
import { fontKey } from "./fonts";
import { splitScripts, type Script } from "./scripts";
import type { TextStyle } from "./types";

export interface ShapedGlyph {
  gid: number;
  /** Pen advance in points. */
  advance: number;
  /** Offset from the pen position, points (y up). */
  dx: number;
  dy: number;
  /** UTF-16 index in the line text where this glyph's cluster starts. */
  cluster: number;
}

export interface ShapedRun {
  font: LoadedFont;
  text: string;
  /** UTF-16 offset of the run in the line text. */
  start: number;
  glyphs: ShapedGlyph[];
  width: number;
}

export interface ShapedLine {
  text: string;
  runs: ShapedRun[];
  width: number;
  /** Characters rendered as notdef because no bundled font has them. */
  missing: string[];
}

const SCRIPTS: Script[] = ["latin", "sinhala", "tamil"];

export async function loadStyleFonts(registry: FontRegistry, style: TextStyle): Promise<Record<Script, LoadedFont>> {
  const fonts = await Promise.all(SCRIPTS.map((s) => registry.get(fontKey(s, style.family, style.bold))));
  return { latin: fonts[0], sinhala: fonts[1], tamil: fonts[2] };
}

export function shapeRun(font: LoadedFont, text: string, start: number, size: number): ShapedRun {
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font.hbFont, buffer);
  const k = size / font.upem;
  const positions = buffer.getGlyphPositions();
  const glyphs = buffer.getGlyphInfos().map((info, i) => ({
    gid: info.codepoint,
    advance: positions[i].xAdvance * k,
    dx: positions[i].xOffset * k,
    dy: positions[i].yOffset * k,
    cluster: start + info.cluster,
  }));
  return { font, text, start, glyphs, width: glyphs.reduce((w, g) => w + g.advance, 0) };
}

export function shapeLine(text: string, style: TextStyle, fonts: Record<Script, LoadedFont>): ShapedLine {
  const runs = splitScripts(text, (script, ch) => fonts[script].hasChar(ch)).map((r) => shapeRun(fonts[r.script], r.text, r.start, style.size));
  const missing = new Set<string>();
  for (const run of runs) {
    for (const g of run.glyphs) if (g.gid === 0) missing.add(String.fromCodePoint(text.codePointAt(g.cluster)!));
  }
  return { text, runs, width: runs.reduce((w, r) => w + r.width, 0), missing: [...missing] };
}

export function shapeText(text: string, style: TextStyle, fonts: Record<Script, LoadedFont>): ShapedLine[] {
  return text.split("\n").map((line) => shapeLine(line, style, fonts));
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/edit` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/edit
git commit -m "feat(edit): HarfBuzz shaper for mixed English/Sinhala/Tamil lines"
```

---

### Task 3: Text writer and embedded fonts (the Unicode layer)

**Files:**
- Modify: `src/engine/types.ts` (add `Matrix`)
- Create: `src/edit/text-writer.ts`, `src/edit/embedded-fonts.ts`, `scripts/pdfkit-check.swift`
- Test: `src/edit/text-writer.test.ts`, `src/edit/roundtrip.test.ts`

**Interfaces:**
- Consumes: `ShapedLine`, `ShapedRun`, `ShapedGlyph` (Task 2), `LoadedFont` (Task 1).
- Produces:
  - `engine/types.ts`: `export type Matrix = [number, number, number, number, number, number];`
  - `text-writer.ts`: `fmt(n)`, `utf16Hex(s)`, `clusterSpans(run): { glyphs; text }[]`, `glyphOps(run, glyphs, size): string`, `interface FontUse { resourceName: string; record(glyphs: ShapedGlyph[], text: string): void }`, `interface TextBlock { lines: ShapedLine[]; size: number; color: [number, number, number]; lineMatrix(line: number): Matrix }`, `textContent(block, useFont: (run: ShapedRun) => FontUse): string`.
  - `embedded-fonts.ts`: `class EmbeddedFonts(pdf)` with `use(font: LoadedFont): { ref: PDFObject; resourceName: string; record(glyphs, text) }`, `flush()`, `reset()`, and pure helper `toUnicodeCMap(map: Map<number, string>): string`.

- [ ] **Step 1: Add Matrix type**

Append to `src/engine/types.ts`:
```ts
export type Matrix = [number, number, number, number, number, number];
```

- [ ] **Step 2: Failing writer unit tests**

`src/edit/text-writer.test.ts`:
```ts
import { expect, test } from "vitest";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { loadStyleFonts, shapeLine } from "./shaper";
import { clusterSpans, fmt, textContent, utf16Hex, type FontUse } from "./text-writer";
import type { TextStyle } from "./types";

const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 12, color: [0.2, 0, 1] };

test("fmt rounds to 3 decimals without -0", () => {
  expect(fmt(1.23456)).toBe("1.235");
  expect(fmt(-0.0001)).toBe("0");
  expect(fmt(12)).toBe("12");
});

test("utf16Hex encodes BMP and astral characters", () => {
  expect(utf16Hex("ක")).toBe("0D9A");
  expect(utf16Hex("𑇡")).toBe("D804DDE1");
});

test("cluster spans cover the run text exactly once, in order", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const run = shapeLine("ශ්‍රී ලංකාව කොළඹ", style, fonts).runs[0];
  const spans = clusterSpans(run);
  expect(spans.map((s) => s.text).join("")).toBe(run.text);
  expect(spans.every((s) => s.glyphs.length > 0)).toBe(true);
});

test("content has colour, font, one ActualText span per cluster, and balanced operators", async () => {
  const fonts = await loadStyleFonts(registry, style);
  const line = shapeLine("කොළඹ Colombo", style, fonts);
  const recorded: string[] = [];
  const use = (): FontUse => ({ resourceName: "F1", record: (_g, text) => void recorded.push(text) });
  const content = textContent({ lines: [line], size: 12, color: style.color, lineMatrix: () => [1, 0, 0, 1, 10, 20] }, use);
  expect(content.startsWith("q BT 0.2 0 1 rg\n1 0 0 1 10 20 Tm\n")).toBe(true);
  expect(content).toContain("/F1 12 Tf");
  const spans = content.match(/\/ActualText/g)!.length;
  expect(spans).toBe(recorded.length);
  expect(recorded.join("")).toBe("කොළඹ Colombo");
  expect(content.match(/ BDC /g)!.length).toBe(content.match(/EMC/g)!.length);
  expect(content.trimEnd().endsWith("ET Q")).toBe(true);
});
```

Run: `npx vitest run src/edit/text-writer.test.ts` → FAIL.

- [ ] **Step 3: Implement text-writer.ts**

`src/edit/text-writer.ts`:
```ts
import type { Matrix } from "../engine/types";
import type { ShapedGlyph, ShapedLine, ShapedRun } from "./shaper";

export function fmt(n: number): string {
  const s = String(Math.round(n * 1000) / 1000);
  return s === "-0" ? "0" : s;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** UTF-16BE hex (no BOM) as used in PDF text strings and ToUnicode CMaps. */
export function utf16Hex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return out;
}

/** Groups a run's glyphs by HarfBuzz cluster with the source text each cluster stands for. */
export function clusterSpans(run: ShapedRun): { glyphs: ShapedGlyph[]; text: string }[] {
  const starts = [...new Set(run.glyphs.map((g) => g.cluster))].sort((a, b) => a - b);
  const end = run.start + run.text.length;
  const spans: { glyphs: ShapedGlyph[]; text: string }[] = [];
  let i = 0;
  while (i < run.glyphs.length) {
    let j = i;
    while (j < run.glyphs.length && run.glyphs[j].cluster === run.glyphs[i].cluster) j++;
    const cluster = run.glyphs[i].cluster;
    const next = starts[starts.indexOf(cluster) + 1] ?? end;
    spans.push({ glyphs: run.glyphs.slice(i, j), text: run.text.slice(cluster - run.start, next - run.start) });
    i = j;
  }
  return spans;
}

/**
 * TJ operators for one cluster: glyph ids with advance corrections so each glyph lands exactly where
 * HarfBuzz placed it, and text rise (Ts) for vertical offsets. Stays in visual order (viewers expect it).
 */
export function glyphOps(run: ShapedRun, glyphs: ShapedGlyph[], size: number): string {
  let ops = "";
  let array = "";
  let rise = 0;
  const toThousandths = (points: number) => fmt((-points * 1000) / size);
  for (const g of glyphs) {
    if (Math.abs(g.dy - rise) > 1e-3) {
      if (array) ops += `[${array}] TJ `;
      array = "";
      ops += `${fmt(g.dy)} Ts `;
      rise = g.dy;
    }
    if (Math.abs(g.dx) > 1e-3) array += `${toThousandths(g.dx)} `;
    array += `<${hex4(g.gid)}> `;
    const drawn = (run.font.defaultAdvance(g.gid) * size) / run.font.upem;
    const correction = g.advance - g.dx - drawn;
    if (Math.abs(correction) > 1e-3) array += `${toThousandths(correction)} `;
  }
  if (array) ops += `[${array}] TJ `;
  if (Math.abs(rise) > 1e-3) ops += "0 Ts ";
  return ops;
}

export interface FontUse {
  resourceName: string;
  /** Called for every cluster written, so the font's ToUnicode map can learn it. */
  record(glyphs: ShapedGlyph[], text: string): void;
}

export interface TextBlock {
  lines: ShapedLine[];
  size: number;
  color: [number, number, number];
  /** Text matrix (PDF space) for the start of each line's baseline. */
  lineMatrix(line: number): Matrix;
}

export function textContent(block: TextBlock, useFont: (run: ShapedRun) => FontUse): string {
  const [r, g, b] = block.color;
  let out = `q BT ${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n`;
  block.lines.forEach((line, index) => {
    out += `${block.lineMatrix(index).map(fmt).join(" ")} Tm\n`;
    for (const run of line.runs) {
      const font = useFont(run);
      out += `/${font.resourceName} ${fmt(block.size)} Tf\n`;
      for (const span of clusterSpans(run)) {
        font.record(span.glyphs, span.text);
        out += `/Span <</ActualText <FEFF${utf16Hex(span.text)}>>> BDC ${glyphOps(run, span.glyphs, block.size)}EMC\n`;
      }
    }
  });
  return out + "ET Q\n";
}
```

Run: `npx vitest run src/edit/text-writer.test.ts` → PASS.

- [ ] **Step 4: Failing round-trip tests (MuPDF extraction must be exact)**

`src/edit/roundtrip.test.ts`:
```ts
import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { EmbeddedFonts, toUnicodeCMap } from "./embedded-fonts";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { loadStyleFonts, shapeText } from "./shaper";
import { textContent } from "./text-writer";
import type { TextStyle } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);

export const CORPUS = [
  "ශ්‍රී ලංකාව නව පෙළ කොළඹ",
  "ප්‍රජාතාන්ත්‍රික ක්‍රියාව ද්‍රව්‍ය",
  "යාපනය කෝට්ටේ ගෞරවය ශාස්ත්‍රීය",
  "யாழ்ப்பாணம் கொழும்பு ஸ்ரீ லங்கா",
  "கொடுத்தார் போனேன் கௌரவம்",
  "Hello ffi 2026, Colombo (LK)",
  "ශ්‍රී ලංකා (2026), யாழ்ப்பாணம்!",
];

/** Writes `lines` onto a blank page with a fresh document and returns the saved bytes. */
export async function writeBlankPdf(lines: string[], style: TextStyle): Promise<Uint8Array> {
  const fonts = await loadStyleFonts(registry, style);
  const doc = new mupdf.PDFDocument();
  const embedded = new EmbeddedFonts(doc);
  const fontDict = doc.newDictionary();
  const content = textContent(
    { lines: shapeText(lines.join("\n"), style, fonts), size: style.size, color: style.color, lineMatrix: (i) => [1, 0, 0, 1, 40, 780 - i * 30] },
    (run) => {
      const use = embedded.use(run.font);
      fontDict.put(use.resourceName, use.ref);
      return use;
    },
  );
  embedded.flush();
  const resources = doc.addObject(doc.newDictionary());
  resources.put("Font", fontDict);
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, resources, content));
  const tmp = new mupdf.PDFDocument(doc.saveToBuffer("").asUint8Array());
  tmp.subsetFonts();
  return tmp.saveToBuffer("garbage,compress").asUint8Array().slice();
}

function extractLines(bytes: Uint8Array): string[] {
  const page = mupdf.Document.openDocument(bytes, "application/pdf").loadPage(0);
  return page.toStructuredText("preserve-whitespace").asText().split("\n").filter((l) => l.trim().length > 0);
}

for (const family of ["sans", "serif"] as const) {
  for (const bold of [false, true]) {
    test(`MuPDF extracts every corpus line exactly (${family}${bold ? " bold" : ""})`, async () => {
      const bytes = await writeBlankPdf(CORPUS, { family, bold, size: 14, color: [0, 0, 0] });
      expect(extractLines(bytes)).toEqual(CORPUS);
    });
  }
}

test("every corpus word is found by MuPDF search", async () => {
  const bytes = await writeBlankPdf(CORPUS, { family: "sans", bold: false, size: 14, color: [0, 0, 0] });
  const page = mupdf.Document.openDocument(bytes, "application/pdf").loadPage(0);
  for (const word of CORPUS.join(" ").split(/\s+/).map((w) => w.replace(/[(),!]/g, "")).filter(Boolean)) {
    expect(page.search(word).length, word).toBeGreaterThan(0);
  }
});

test("subsetting keeps fonts small", async () => {
  const bytes = await writeBlankPdf(CORPUS, { family: "sans", bold: false, size: 14, color: [0, 0, 0] });
  expect(bytes.length).toBeLessThan(80_000);
});

test("ToUnicode CMap lists only non-empty mappings", () => {
  const cmap = toUnicodeCMap(new Map([[5, "ශ්‍රී"], [6, ""], [7, "A"]]));
  expect(cmap).toContain("2 beginbfchar");
  expect(cmap).toContain("<0005> <0DC10DCA200D0DBB0DD3>");
  expect(cmap).not.toContain("<0006>");
});
```

Run: `npx vitest run src/edit/roundtrip.test.ts` → FAIL (embedded-fonts missing).

- [ ] **Step 5: Implement embedded-fonts.ts**

`src/edit/embedded-fonts.ts`:
```ts
import * as mupdf from "mupdf";
import type { LoadedFont } from "./font-registry";
import type { FontKey } from "./fonts";
import type { ShapedGlyph } from "./shaper";
import { utf16Hex } from "./text-writer";

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

export function toUnicodeCMap(map: Map<number, string>): string {
  const entries = [...map.entries()].filter(([, text]) => text.length > 0).sort((a, b) => a[0] - b[0]);
  const lines = entries.map(([gid, text]) => `<${hex4(gid)}> <${utf16Hex(text)}>`);
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += 100) {
    const chunk = lines.slice(i, i + 100);
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def",
    "1 begincodespacerange <0000> <FFFF> endcodespacerange",
    ...chunks,
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
}

interface Embedded {
  font: LoadedFont;
  ref: mupdf.PDFObject;
  resourceName: string;
  /** glyph id → the character the font's cmap maps to it */
  natural: Map<number, string>;
  toUnicode: Map<number, string>;
  dirty: boolean;
}

/** Embeds bundled fonts into one document and keeps their ToUnicode maps in step with what was written. */
export class EmbeddedFonts {
  private fonts = new Map<FontKey, Embedded>();

  constructor(private readonly pdf: mupdf.PDFDocument) {}

  use(font: LoadedFont) {
    let e = this.fonts.get(font.key);
    if (!e) {
      e = { font, ref: this.pdf.addFont(font.mu), resourceName: `LeoF-${font.key}`, natural: new Map(), toUnicode: new Map(), dirty: true };
      this.fonts.set(font.key, e);
    }
    const entry = e;
    return { ref: entry.ref, resourceName: entry.resourceName, record: (glyphs: ShapedGlyph[], text: string) => this.record(entry, glyphs, text) };
  }

  /** Writes changed ToUnicode maps into the document. Call before ending an edit operation. */
  flush(): void {
    for (const e of this.fonts.values()) {
      if (!e.dirty) continue;
      const cmap = toUnicodeCMap(e.toUnicode);
      const existing = e.ref.get("ToUnicode");
      if (existing.isStream()) existing.writeStream(cmap);
      else e.ref.put("ToUnicode", this.pdf.addStream(cmap, this.pdf.newDictionary()));
      e.dirty = false;
    }
  }

  /** Forget embedded fonts (after undo/redo may have removed them); the next write embeds afresh. */
  reset(): void {
    this.fonts.clear();
  }

  private record(e: Embedded, glyphs: ShapedGlyph[], text: string): void {
    for (const ch of new Set([...Array.from(text), ...Array.from(text.normalize("NFD"))])) {
      const gid = e.font.mu.encodeCharacter(ch.codePointAt(0)!);
      if (gid > 0 && !e.natural.has(gid)) e.natural.set(gid, ch);
    }
    const set = (gid: number, value: string) => {
      if (e.toUnicode.has(gid)) return;
      e.toUnicode.set(gid, value);
      e.dirty = true;
    };
    if (glyphs.length === 1) {
      set(glyphs[0].gid, text);
      return;
    }
    // Several glyphs for one cluster: glyphs with a natural character keep it; the rest share
    // whatever characters of the cluster are left, so the concatenation stays close to the text.
    let remaining = Array.from(text.normalize("NFD"));
    for (const g of glyphs) {
      const ch = e.natural.get(g.gid);
      const at = ch ? remaining.indexOf(ch.normalize("NFD")) : -1;
      if (at >= 0) remaining.splice(at, 1);
    }
    for (const g of glyphs) {
      const ch = e.natural.get(g.gid);
      if (ch) set(g.gid, ch);
      else if (remaining.length > 0) {
        set(g.gid, remaining.join(""));
        remaining = [];
      } else set(g.gid, "");
    }
  }
}
```

- [ ] **Step 6: Run round-trip tests**

Run: `npx vitest run src/edit` → PASS.
If a corpus line comes back split across two lines only where a glyph has a vertical offset (`Ts`), replace the `Ts` approach in `glyphOps` with a text-matrix-free alternative: move the raised glyph with a `TJ` adjustment before it and draw it on the same baseline (vertical offsets for Sinhala/Tamil marks are small); record the change as a ruling. The corpus test is the acceptance gate.

- [ ] **Step 7: PDFKit measurement script (macOS, not part of `npm test`)**

`scripts/pdfkit-check.swift`:
```swift
// Usage: swift scripts/pdfkit-check.swift file.pdf "expected line 1" "expected line 2" ...
// Prints how many expected lines PDFKit extracts exactly and how many words it can find.
import PDFKit
let args = Array(CommandLine.arguments.dropFirst())
guard let path = args.first, let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { print("cannot open"); exit(1) }
let lines = Array(args.dropFirst())
let text = (0..<doc.pageCount).compactMap { doc.page(at: $0)?.string }.joined(separator: "\n")
var exact = 0, words = 0, found = 0
for line in lines {
  if text.contains(line) { exact += 1 }
  for w in line.split(separator: " ") { words += 1; if !doc.findString(String(w), withOptions: []).isEmpty { found += 1 } }
}
print("PDFKit: exact lines \(exact)/\(lines.count), words found \(found)/\(words)")
```
Add to `package.json` scripts: `"check:pdfkit": "vitest run src/edit/pdfkit.check.ts"` and create `src/edit/pdfkit.check.ts` (not matched by the default `*.test.ts` include):
```ts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { CORPUS, writeBlankPdf } from "./roundtrip.test";

test.runIf(process.platform === "darwin")("PDFKit extraction report", async () => {
  const file = join(tmpdir(), "leopdf-pdfkit-check.pdf");
  writeFileSync(file, await writeBlankPdf(CORPUS, { family: "sans", bold: false, size: 14, color: [0, 0, 0] }));
  console.log(execFileSync("swift", ["scripts/pdfkit-check.swift", file, ...CORPUS], { encoding: "utf8" }));
}, 180_000);
```
Update `vite.config.ts` test include to `["src/**/*.test.{ts,tsx}", "src/**/*.check.ts"]` only when `process.env.LEOPDF_CHECKS` is set:
```ts
test: { environment: "node", include: process.env.LEOPDF_CHECKS ? ["src/**/*.check.ts"] : ["src/**/*.test.{ts,tsx}"] },
```
and the script becomes `"check:pdfkit": "LEOPDF_CHECKS=1 vitest run"`.
Run: `npm run check:pdfkit` → prints a report (expected from the spike: all Latin lines exact; Sinhala/Tamil words without pre-base vowel signs found; pre-base vowel words may not be found — a PDFKit limitation shared by Chrome-made PDFs). Record the numbers in the ledger.

- [ ] **Step 8: Commit**

```bash
git add src/engine/types.ts src/edit scripts/pdfkit-check.swift package.json vite.config.ts
git commit -m "feat(edit): write shaped text with per-cluster ActualText and ToUnicode"
```

---

### Task 4: Page space and LeoPDF text objects

**Files:**
- Create: `src/edit/page-space.ts`, `src/edit/page-objects.ts`
- Test: `src/edit/page-objects.test.ts`

**Interfaces:**
- Consumes: `textContent`, `FontUse` (Task 3), `EmbeddedFonts` (Task 3), `ShapedLine` (Task 2), `TextStyle`, `PageObject` (Task 2), `Matrix`, `Point`, `Rect` (engine/types).
- Produces:
  - `page-space.ts`: `pageToPdf(page): Matrix`, `textMatrixAt(page, origin): Matrix`, `imageMatrixFor(page, rect): Matrix`, `ensureOwnResources(pdf, page): PDFObject` (returns the page's own `Resources` dict), `wrapContents(pdf, page)`, `appendContent(pdf, page, content): PDFObject`, `removeContent(page, ref)`.
  - `page-objects.ts`: `interface EditContext { pdf; page: PDFPage; fonts: EmbeddedFonts }`, `lineHeight(style)`, `textRect(origin, lines, style): Rect`, `listObjects(page): PageObject[]`, `addTextObject(ctx, origin, text, style, lines): string`, `updateTextObject(ctx, id, text, style, lines)`, `moveObject(ctx, id, dx, dy, relayout?)`, `deleteObject(ctx, id)`, plus internal `findStored(page, id)` used by Task 5.
  - Stored metadata: page dict key `LeoPDFObjects` = array of dicts `{ Id: (string), Data: (ASCII JSON), Stream: ref, Image?: ref, Name?: /LeoImN }`.

- [ ] **Step 1: Failing tests**

`src/edit/page-objects.test.ts`:
```ts
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { EmbeddedFonts } from "./embedded-fonts";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import { addTextObject, deleteObject, listObjects, moveObject, updateTextObject, type EditContext } from "./page-objects";
import { loadStyleFonts, shapeText } from "./shaper";
import type { TextStyle } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 14, color: [0, 0, 0] };
const fixture = () => new mupdf.PDFDocument(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));

async function ctxFor(pdf: mupdf.PDFDocument, page = 0): Promise<EditContext> {
  return { pdf, page: pdf.loadPage(page), fonts: new EmbeddedFonts(pdf) };
}
async function add(ctx: EditContext, text: string, origin: [number, number] = [72, 400]) {
  const lines = shapeText(text, style, await loadStyleFonts(registry, style));
  const id = addTextObject(ctx, origin, text, style, lines);
  ctx.fonts.flush();
  return id;
}
const pageText = (pdf: mupdf.PDFDocument, i = 0) => pdf.loadPage(i).toStructuredText("preserve-whitespace").asText();
function reopen(pdf: mupdf.PDFDocument) {
  return mupdf.Document.openDocument(pdf.saveToBuffer("").asUint8Array(), "application/pdf").asPDF()!;
}

test("added text appears in the page text and survives save", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  await add(ctx, "යාපනය யாழ்ப்பாணம் Jaffna");
  const saved = reopen(pdf);
  expect(pageText(saved)).toContain("යාපනය யாழ்ப்பாணம் Jaffna");
  expect(pageText(saved)).toContain("Hello world"); // original text untouched
});

test("added text is listed with its style, origin and a sensible rect", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  const id = await add(ctx, "කොළඹ", [100, 300]);
  const [obj] = listObjects(ctx.page);
  expect(obj).toMatchObject({ id, kind: "text", text: "කොළඹ", style, origin: [100, 300] });
  expect(obj.rect[0]).toBe(100);
  expect(obj.rect[1]).toBeLessThan(300);
  expect(obj.rect[3]).toBeGreaterThan(300);
  expect(obj.rect[2]).toBeGreaterThan(100);
});

test("placed where clicked: extracted text starts at the origin", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  await add(ctx, "Colombo", [200, 500]);
  const json = JSON.parse(pdf.loadPage(0).toStructuredText("preserve-whitespace").asJSON());
  const line = json.blocks.flatMap((b: { lines?: { text: string; x: number; y: number }[] }) => b.lines ?? []).find((l: { text: string }) => l.text === "Colombo");
  expect(line.x).toBeCloseTo(200, 0);
  expect(line.y).toBeCloseTo(500, 0);
});

test("update, move and delete change only that object", async () => {
  const pdf = fixture();
  const ctx = await ctxFor(pdf);
  const a = await add(ctx, "කොළඹ", [72, 300]);
  const b = await add(ctx, "யாழ்ப்பாணம்", [72, 360]);
  const fontsLoaded = await loadStyleFonts(registry, style);
  updateTextObject(ctx, a, "ගාල්ල", style, shapeText("ගාල්ල", style, fontsLoaded));
  ctx.fonts.flush();
  moveObject(ctx, b, 10, 20, (o) => shapeText(o.text!, style, fontsLoaded));
  ctx.fonts.flush();
  const objs = listObjects(ctx.page);
  expect(objs.find((o) => o.id === a)!.text).toBe("ගාල්ල");
  expect(objs.find((o) => o.id === b)!.origin).toEqual([82, 380]);
  expect(pageText(pdf)).not.toContain("කොළඹ");
  deleteObject(ctx, a);
  expect(listObjects(ctx.page).map((o) => o.id)).toEqual([b]);
  expect(pageText(pdf)).not.toContain("ගාල්ල");
  expect(pageText(pdf)).toContain("யாழ்ப்பாணம்");
});

test("rotated page: text is placed upright at the clicked point", async () => {
  const pdf = fixture();
  pdf.loadPage(0).getObject().put("Rotate", 90);
  const ctx = await ctxFor(pdf);
  await add(ctx, "Colombo", [150, 120]);
  const json = JSON.parse(pdf.loadPage(0).toStructuredText("preserve-whitespace").asJSON());
  const line = json.blocks.flatMap((b: { lines?: { text: string; x: number; y: number; dir?: { x: number; y: number } }[] }) => b.lines ?? []).find((l: { text: string }) => l.text === "Colombo");
  expect(line.x).toBeCloseTo(150, 0);
  expect(line.y).toBeCloseTo(120, 0);
});

test("shared resources: editing page 1 does not touch page 2", async () => {
  const pdf = new mupdf.PDFDocument();
  const shared = pdf.addObject(pdf.newDictionary());
  shared.put("Font", pdf.newDictionary());
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, shared, "BT ET"));
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, shared, "BT ET"));
  const ctx = await ctxFor(pdf, 0);
  await add(ctx, "කොළඹ");
  expect(pdf.loadPage(1).getObject().get("Resources").get("Font").toString()).toBe("<<>>");
  expect(pageText(pdf, 1).trim()).toBe("");
});

test("single-stream Contents and inherited Resources are handled", async () => {
  const pdf = new mupdf.PDFDocument();
  const res = pdf.addObject(pdf.newDictionary());
  const pageRef = pdf.addPage([0, 0, 595, 842], 0, res, "BT ET");
  pdf.insertPage(-1, pageRef);
  const pages = pdf.getTrailer().get("Root", "Pages");
  pages.put("Resources", res);
  pdf.loadPage(0).getObject().delete("Resources"); // now inherited
  const ctx = await ctxFor(pdf, 0);
  await add(ctx, "Jaffna");
  expect(pageText(pdf)).toContain("Jaffna");
});
```

Run: `npx vitest run src/edit/page-objects.test.ts` → FAIL.

- [ ] **Step 2: Implement page-space.ts**

`src/edit/page-space.ts`:
```ts
import * as mupdf from "mupdf";
import type { Matrix, Point, Rect } from "../engine/types";

/** Maps page space (what the viewer shows: y down, rotation applied) to PDF user space. */
export function pageToPdf(page: mupdf.PDFPage): Matrix {
  return mupdf.Matrix.invert(page.getTransform()) as Matrix;
}

/** Text matrix for a baseline starting at `origin` (page space), upright as seen in the viewer. */
export function textMatrixAt(page: mupdf.PDFPage, origin: Point): Matrix {
  return mupdf.Matrix.concat([1, 0, 0, -1, origin[0], origin[1]], pageToPdf(page)) as Matrix;
}

/** `cm` matrix that draws an image's unit square into `rect` (page space), upright. */
export function imageMatrixFor(page: mupdf.PDFPage, rect: Rect): Matrix {
  const [x0, y0, x1, y1] = rect;
  return mupdf.Matrix.concat([x1 - x0, 0, 0, -(y1 - y0), x0, y1], pageToPdf(page)) as Matrix;
}

function copyDict(pdf: mupdf.PDFDocument, from: mupdf.PDFObject): mupdf.PDFObject {
  const copy = pdf.newDictionary();
  if (from.isDictionary()) from.forEach((value, key) => copy.put(key, value));
  return copy;
}

/**
 * Gives the page its own Resources dictionary (with its own Font and XObject sub-dictionaries), so
 * adding resources never changes other pages that shared or inherited the original.
 */
export function ensureOwnResources(pdf: mupdf.PDFDocument, page: mupdf.PDFPage): mupdf.PDFObject {
  const pageObj = page.getObject();
  if (pageObj.get("LeoPDFOwnResources").asBoolean()) return pageObj.get("Resources");
  const own = copyDict(pdf, pageObj.getInheritable("Resources").resolve());
  own.put("Font", copyDict(pdf, own.get("Font").resolve()));
  own.put("XObject", copyDict(pdf, own.get("XObject").resolve()));
  pageObj.put("Resources", pdf.addObject(own));
  pageObj.put("LeoPDFOwnResources", true);
  return pageObj.get("Resources");
}

function contentsArray(pdf: mupdf.PDFDocument, pageObj: mupdf.PDFObject): mupdf.PDFObject {
  const contents = pageObj.get("Contents");
  if (contents.isArray()) return contents;
  const array = pdf.newArray();
  if (!contents.isNull()) array.push(contents);
  pageObj.put("Contents", array);
  return pageObj.get("Contents");
}

/** Wraps the original content in q … Q once, so its graphics state cannot leak into added content. */
export function wrapContents(pdf: mupdf.PDFDocument, page: mupdf.PDFPage): void {
  const pageObj = page.getObject();
  if (pageObj.get("LeoPDFWrapped").asBoolean()) return;
  const original = contentsArray(pdf, pageObj);
  const wrapped = pdf.newArray();
  wrapped.push(pdf.addStream("q\n", pdf.newDictionary()));
  for (let i = 0; i < original.length; i++) wrapped.push(original.get(i));
  wrapped.push(pdf.addStream("Q\n", pdf.newDictionary()));
  pageObj.put("Contents", wrapped);
  pageObj.put("LeoPDFWrapped", true);
}

export function appendContent(pdf: mupdf.PDFDocument, page: mupdf.PDFPage, content: string): mupdf.PDFObject {
  wrapContents(pdf, page);
  const stream = pdf.addStream(content, pdf.newDictionary());
  contentsArray(pdf, page.getObject()).push(stream);
  return stream;
}

export function removeContent(page: mupdf.PDFPage, ref: mupdf.PDFObject): void {
  const contents = page.getObject().get("Contents");
  for (let i = 0; i < contents.length; i++) {
    if (contents.get(i).asIndirect() === ref.asIndirect()) {
      contents.delete(i);
      return;
    }
  }
}
```

- [ ] **Step 3: Implement page-objects.ts**

`src/edit/page-objects.ts`:
```ts
import * as mupdf from "mupdf";
import type { Point, Rect } from "../engine/types";
import type { EmbeddedFonts } from "./embedded-fonts";
import { appendContent, ensureOwnResources, imageMatrixFor, removeContent, textMatrixAt } from "./page-space";
import type { ShapedLine } from "./shaper";
import { fmt, textContent } from "./text-writer";
import type { PageObject, TextStyle } from "./types";

export interface EditContext {
  pdf: mupdf.PDFDocument;
  page: mupdf.PDFPage;
  fonts: EmbeddedFonts;
}

export const lineHeight = (style: TextStyle) => style.size * 1.4;

export function textRect(origin: Point, lines: ShapedLine[], style: TextStyle): Rect {
  const width = Math.max(style.size, ...lines.map((l) => l.width));
  return [origin[0], origin[1] - style.size * 1.05, origin[0] + width, origin[1] + (lines.length - 1) * lineHeight(style) + style.size * 0.4];
}

/** JSON with every non-ASCII character escaped, safe to store as a PDF string. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

interface Stored {
  entry: mupdf.PDFObject;
  index: number;
  object: PageObject;
}

function storeArray(ctx: EditContext): mupdf.PDFObject {
  const pageObj = ctx.page.getObject();
  if (!pageObj.get("LeoPDFObjects").isArray()) pageObj.put("LeoPDFObjects", ctx.pdf.newArray());
  return pageObj.get("LeoPDFObjects");
}

export function listObjects(page: mupdf.PDFPage): PageObject[] {
  const array = page.getObject().get("LeoPDFObjects");
  const out: PageObject[] = [];
  for (let i = 0; i < array.length; i++) out.push(JSON.parse(array.get(i).get("Data").asString()));
  return out;
}

export function findStored(page: mupdf.PDFPage, id: string): Stored {
  const array = page.getObject().get("LeoPDFObjects");
  for (let i = 0; i < array.length; i++) {
    const entry = array.get(i);
    if (entry.get("Id").asString() === id) return { entry, index: i, object: JSON.parse(entry.get("Data").asString()) };
  }
  throw new Error(`Unknown object ${id}`);
}

function nextId(ctx: EditContext, prefix: "t" | "i"): string {
  const pageObj = ctx.page.getObject();
  const n = (pageObj.get("LeoPDFNextId").isNumber() ? pageObj.get("LeoPDFNextId").asNumber() : 0) + 1;
  pageObj.put("LeoPDFNextId", n);
  return `${prefix}${n}`;
}

function tagged(id: string, body: string): string {
  return `/LeoPDF <</Id (${id})>> BDC\n${body}EMC\n`;
}

function textBody(ctx: EditContext, origin: Point, lines: ShapedLine[], style: TextStyle): string {
  const fontDict = ensureOwnResources(ctx.pdf, ctx.page).get("Font");
  return textContent(
    { lines, size: style.size, color: style.color, lineMatrix: (i) => textMatrixAt(ctx.page, [origin[0], origin[1] + i * lineHeight(style)]) },
    (run) => {
      const use = ctx.fonts.use(run.font);
      fontDict.put(use.resourceName, use.ref);
      return use;
    },
  );
}

export function imageBody(ctx: EditContext, name: string, rect: Rect): string {
  return `q ${imageMatrixFor(ctx.page, rect).map(fmt).join(" ")} cm /${name} Do Q\n`;
}

/** Adds a stored object: a tagged content stream plus its metadata entry. Returns the entry. */
export function storeObject(ctx: EditContext, object: PageObject, body: string, extra: Record<string, unknown> = {}): mupdf.PDFObject {
  const stream = appendContent(ctx.pdf, ctx.page, tagged(object.id, body));
  const entry = ctx.pdf.newDictionary();
  entry.put("Id", ctx.pdf.newString(object.id));
  entry.put("Data", ctx.pdf.newString(asciiJson(object)));
  entry.put("Stream", stream);
  for (const [k, v] of Object.entries(extra)) entry.put(k, v);
  storeArray(ctx).push(entry);
  return entry;
}

/** Rewrites a stored object's content and metadata in place. */
export function rewriteObject(ctx: EditContext, stored: Stored, object: PageObject, body: string): void {
  stored.entry.get("Stream").writeStream(tagged(object.id, body));
  stored.entry.put("Data", ctx.pdf.newString(asciiJson(object)));
}

export function addTextObject(ctx: EditContext, origin: Point, text: string, style: TextStyle, lines: ShapedLine[]): string {
  const object: PageObject = { id: nextId(ctx, "t"), kind: "text", rect: textRect(origin, lines, style), text, style, origin };
  storeObject(ctx, object, textBody(ctx, origin, lines, style));
  return object.id;
}

export function updateTextObject(ctx: EditContext, id: string, text: string, style: TextStyle, lines: ShapedLine[]): void {
  const stored = findStored(ctx.page, id);
  const origin = stored.object.origin!;
  rewriteObject(ctx, stored, { ...stored.object, text, style, rect: textRect(origin, lines, style) }, textBody(ctx, origin, lines, style));
}

/**
 * Moves an object by (dx, dy) in page space. Text is re-laid out by `relayout` (which re-shapes with
 * the stored style) because its content embeds absolute positions; images just get a new matrix.
 */
export function moveObject(ctx: EditContext, id: string, dx: number, dy: number, relayout?: (object: PageObject) => ShapedLine[]): void {
  const stored = findStored(ctx.page, id);
  const o = stored.object;
  const rect: Rect = [o.rect[0] + dx, o.rect[1] + dy, o.rect[2] + dx, o.rect[3] + dy];
  if (o.kind === "text") {
    const origin: Point = [o.origin![0] + dx, o.origin![1] + dy];
    const lines = relayout ? relayout(o) : [];
    rewriteObject(ctx, stored, { ...o, origin, rect }, textBody(ctx, origin, lines, o.style!));
  } else {
    rewriteObject(ctx, stored, { ...o, rect }, imageBody(ctx, stored.entry.get("Name").asName(), rect));
  }
}

export function deleteObject(ctx: EditContext, id: string): void {
  const stored = findStored(ctx.page, id);
  removeContent(ctx.page, stored.entry.get("Stream"));
  ctx.page.getObject().get("LeoPDFObjects").delete(stored.index);
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/edit` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/edit
git commit -m "feat(edit): LeoPDF text objects in their own tagged content streams"
```

---

### Task 5: Images (added and existing)

**Files:**
- Modify: `src/edit/page-objects.ts` (image add/resize)
- Create: `src/edit/existing-images.ts`
- Test: `src/edit/images.test.ts`

**Interfaces:**
- Consumes: `storeObject`, `rewriteObject`, `imageBody`, `findStored`, `listObjects`, `EditContext` (Task 4), `ensureOwnResources` (Task 4), `ExistingImage` (Task 2).
- Produces: `addImageObject(ctx, image: mupdf.Image, rect): string`, `resizeObject(ctx, id, rect)`, `replaceObjectImage(ctx, id, image)`, `defaultImageRect(pageBounds, image): Rect`; `listExistingImages(page): ExistingImage[]`, `deleteExistingImage(page, rect)`, `takeExistingImage(page, rect): mupdf.Image` (removes it and returns the image so it can be re-added as an object).

- [ ] **Step 1: Failing tests**

`src/edit/images.test.ts`:
```ts
import * as mupdf from "mupdf";
import { expect, test } from "vitest";
import { EmbeddedFonts } from "./embedded-fonts";
import { deleteExistingImage, listExistingImages, takeExistingImage } from "./existing-images";
import { addImageObject, defaultImageRect, deleteObject, listObjects, moveObject, replaceObjectImage, resizeObject, type EditContext } from "./page-objects";

mupdf.setLog({ warning: () => {}, error: () => {} });

function image(w = 40, h = 20, gray = 90) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  pix.clear(gray);
  return new mupdf.Image(pix);
}

/** A page with two existing images drawn by the original content. */
function docWithImages() {
  const pdf = new mupdf.PDFDocument();
  const res = pdf.addObject(pdf.newDictionary());
  const xo = pdf.newDictionary();
  xo.put("Im1", pdf.addImage(image(40, 20, 50)));
  xo.put("Im2", pdf.addImage(image(30, 30, 200)));
  res.put("XObject", xo);
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, res, "q 100 0 0 50 50 700 cm /Im1 Do Q q 60 0 0 60 300 500 cm /Im2 Do Q"));
  return pdf;
}
const ctxFor = (pdf: mupdf.PDFDocument): EditContext => ({ pdf, page: pdf.loadPage(0), fonts: new EmbeddedFonts(pdf) });
/** Every image drawn on page 0 (LeoPDF's own and original ones). */
function imageCount(pdf: mupdf.PDFDocument): number {
  let n = 0;
  pdf.loadPage(0).toStructuredText("preserve-images").walk({ onImageBlock: () => void n++ });
  return n;
}

test("existing images are listed with page-space rects", () => {
  const rects = listExistingImages(docWithImages().loadPage(0)).map((i) => i.rect.map(Math.round));
  expect(rects).toContainEqual([50, 92, 150, 142]);
  expect(rects).toContainEqual([300, 282, 360, 342]);
});

test("deleting an existing image removes only that image", () => {
  const pdf = docWithImages();
  deleteExistingImage(pdf.loadPage(0), [50, 92, 150, 142]);
  expect(listExistingImages(pdf.loadPage(0)).map((i) => i.rect.map(Math.round))).toEqual([[300, 282, 360, 342]]);
});

test("added images are objects: move, resize, replace, delete", () => {
  const pdf = new mupdf.PDFDocument();
  pdf.insertPage(-1, pdf.addPage([0, 0, 595, 842], 0, pdf.addObject(pdf.newDictionary()), ""));
  const ctx = ctxFor(pdf);
  const id = addImageObject(ctx, image(), [100, 100, 200, 150]);
  expect(listObjects(ctx.page)).toEqual([{ id, kind: "image", rect: [100, 100, 200, 150] }]);
  expect(imageCount(pdf)).toBe(1);
  moveObject(ctx, id, 10, 5);
  resizeObject(ctx, id, [110, 105, 310, 205]);
  expect(listObjects(ctx.page)[0].rect).toEqual([110, 105, 310, 205]);
  const drawn: number[][] = [];
  pdf.loadPage(0).toStructuredText("preserve-images").walk({ onImageBlock: (bbox) => void drawn.push(bbox.map(Math.round)) });
  expect(drawn).toEqual([[110, 105, 310, 205]]);
  expect(listExistingImages(pdf.loadPage(0))).toEqual([]); // LeoPDF's own images are listed as objects, not existing images
  replaceObjectImage(ctx, id, image(10, 10, 255));
  expect(imageCount(pdf)).toBe(1);
  deleteObject(ctx, id);
  expect(imageCount(pdf)).toBe(0);
});

test("taking an existing image returns it so it can become a movable object", () => {
  const pdf = docWithImages();
  const ctx = ctxFor(pdf);
  const img = takeExistingImage(ctx.page, [300, 282, 360, 342]);
  expect(img.getWidth()).toBe(30);
  expect(imageCount(pdf)).toBe(1);
  addImageObject(ctx, img, [300, 282, 360, 342]);
  expect(imageCount(pdf)).toBe(2);
});

test("default image rect keeps aspect ratio, fits the page and is centred", () => {
  const rect = defaultImageRect([0, 0, 595, 842], image(4000, 2000));
  expect(rect[2] - rect[0]).toBeLessThanOrEqual(595 * 0.8 + 0.01);
  expect((rect[2] - rect[0]) / (rect[3] - rect[1])).toBeCloseTo(2);
  expect((rect[0] + rect[2]) / 2).toBeCloseTo(297.5);
});
```

Run: `npx vitest run src/edit/images.test.ts` → FAIL.

- [ ] **Step 2: Implement image objects in page-objects.ts**

Append to `src/edit/page-objects.ts`:
```ts
export function defaultImageRect(pageBounds: Rect, image: mupdf.Image): Rect {
  const [px0, py0, px1, py1] = pageBounds;
  const pageW = px1 - px0;
  const pageH = py1 - py0;
  // Assume 96 dpi for images without useful resolution info.
  let w = (image.getWidth() * 72) / 96;
  let h = (image.getHeight() * 72) / 96;
  const scale = Math.min(1, (pageW * 0.8) / w, (pageH * 0.8) / h);
  w *= scale;
  h *= scale;
  const x0 = px0 + (pageW - w) / 2;
  const y0 = py0 + (pageH - h) / 2;
  return [x0, y0, x0 + w, y0 + h];
}

function registerImage(ctx: EditContext, image: mupdf.Image): { name: string; ref: mupdf.PDFObject } {
  const xobjects = ensureOwnResources(ctx.pdf, ctx.page).get("XObject");
  const ref = ctx.pdf.addImage(image);
  let n = 1;
  while (!xobjects.get(`LeoIm${n}`).isNull()) n++;
  const name = `LeoIm${n}`;
  xobjects.put(name, ref);
  return { name, ref };
}

export function addImageObject(ctx: EditContext, image: mupdf.Image, rect: Rect): string {
  const { name, ref } = registerImage(ctx, image);
  const object: PageObject = { id: nextId(ctx, "i"), kind: "image", rect };
  storeObject(ctx, object, imageBody(ctx, name, rect), { Image: ref, Name: ctx.pdf.newName(name) });
  return object.id;
}

export function resizeObject(ctx: EditContext, id: string, rect: Rect): void {
  const stored = findStored(ctx.page, id);
  if (stored.object.kind !== "image") throw new Error(`Object ${id} is not an image`);
  rewriteObject(ctx, stored, { ...stored.object, rect }, imageBody(ctx, stored.entry.get("Name").asName(), rect));
}

export function replaceObjectImage(ctx: EditContext, id: string, image: mupdf.Image): void {
  const stored = findStored(ctx.page, id);
  const { name, ref } = registerImage(ctx, image);
  stored.entry.put("Image", ref);
  stored.entry.put("Name", ctx.pdf.newName(name));
  rewriteObject(ctx, stored, stored.object, imageBody(ctx, name, stored.object.rect));
}
```

- [ ] **Step 3: Implement existing-images.ts**

`src/edit/existing-images.ts`:
```ts
import * as mupdf from "mupdf";
import type { Rect } from "../engine/types";
import { listObjects } from "./page-objects";
import type { ExistingImage } from "./types";

interface Found {
  rect: Rect;
  image: mupdf.Image;
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (a[2] - a[0]) * (a[3] - a[1]);
  return area > 0 ? (w * h) / area : 0;
}

function findImages(page: mupdf.PDFPage): Found[] {
  const found: Found[] = [];
  const stext = page.toStructuredText("preserve-images");
  stext.walk({ onImageBlock: (bbox, _transform, image) => void found.push({ rect: bbox as Rect, image }) });
  stext.destroy();
  return found;
}

/** Images from the original PDF content (not ones LeoPDF added, which are listed as objects). */
export function listExistingImages(page: mupdf.PDFPage): ExistingImage[] {
  const ours = listObjects(page).filter((o) => o.kind === "image").map((o) => o.rect);
  return findImages(page)
    .filter((f) => !ours.some((r) => overlapRatio(f.rect, r) > 0.9 && overlapRatio(r, f.rect) > 0.9))
    .map((f) => ({ rect: f.rect }));
}

/** Removes the image(s) drawn inside `rect` (image-only redaction; text and drawings stay). */
export function deleteExistingImage(page: mupdf.PDFPage, rect: Rect): void {
  const inset = 0.5;
  const annot = page.createAnnotation("Redact");
  annot.setRect([rect[0] + inset, rect[1] + inset, rect[2] - inset, rect[3] - inset]);
  page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_REMOVE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_NONE);
}

/** Removes an existing image and returns it, so it can be re-added as a movable LeoPDF object. */
export function takeExistingImage(page: mupdf.PDFPage, rect: Rect): mupdf.Image {
  const match = findImages(page).find((f) => overlapRatio(f.rect, rect) > 0.9 && overlapRatio(rect, f.rect) > 0.9);
  if (!match) throw new Error("No image at that position");
  deleteExistingImage(page, rect);
  return match.image;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/edit` → PASS. If the existing-image redaction also removes a LeoPDF image overlapping the same area, note it as a known limitation in the ledger (spec §6 lists redaction side effects).

- [ ] **Step 5: Commit**

```bash
git add src/edit
git commit -m "feat(edit): add, move, resize, replace and delete images"
```

---

### Task 6: DocumentEditor (undo/redo, save) and engine integration

**Files:**
- Create: `src/edit/editor.ts`
- Modify: `src/engine/types.ts` (DocInfo: `editable`, `signed`), `src/engine/document-engine.ts`, `src/engine/engine-api.ts`, `src/engine/lazy-api.ts`, `src/engine/lazy-api.test.ts`, `src/engine/worker.ts`
- Test: `src/edit/editor.test.ts`, extend `src/engine/document-engine.test.ts`

**Interfaces:**
- Consumes: everything in `src/edit` from Tasks 1–5.
- Produces:
  - `DocumentEditor(pdf, registry)` methods (all return `EditResult` unless noted): `addText(page, origin, text, style)`, `updateText(page, id, text, style)`, `moveObject(page, id, dx, dy)`, `resizeObject(page, id, rect)`, `deleteObject(page, id)`, `addImage(page, bytes, rect | null)`, `replaceImage(page, target: { id: string } | { rect: Rect }, bytes)`, `deleteImage(page, rect)`, `moveExistingImage(page, rect, dx, dy)`, `listObjects(page): PageObject[]`, `listImages(page): ExistingImage[]`, `undo()`, `redo()`, `history(): HistoryState`, `save(): Uint8Array`, `markSaved(): HistoryState`.
  - `DocInfo` gains `editable: boolean` and `signed: boolean`.
  - `DocumentEngine` constructor `(options?: { fontSource?: FontSource })`; methods with the same names as the editor, prefixed by `docId` and page where relevant (e.g. `addText(docId, page, origin, text, style)`), plus `listObjects(docId, page)`, `listImages(docId, page)`, `undo(docId)`, `redo(docId)`, `history(docId)`, `save(docId)`, `markSaved(docId)`. All edit methods are `async`.
  - `lazy-api.ts`: method list = `Object.keys` of the API type (kept in sync by test).

- [ ] **Step 1: Failing editor tests**

`src/edit/editor.test.ts`:
```ts
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { DocumentEditor } from "./editor";
import { FontRegistry } from "./font-registry";
import { nodeFontSource } from "./node-font-source";
import type { TextStyle } from "./types";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);
const style: TextStyle = { family: "sans", bold: false, size: 14, color: [0, 0, 0] };
const png = (() => {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 8, 8], false);
  pix.clear(120);
  return pix.asPNG().slice();
})();

let pdf: mupdf.PDFDocument;
let editor: DocumentEditor;
beforeEach(() => {
  pdf = new mupdf.PDFDocument(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));
  editor = new DocumentEditor(pdf, registry);
});
const text = (bytes?: Uint8Array) =>
  (bytes ? mupdf.Document.openDocument(bytes, "application/pdf") : pdf).loadPage(0).toStructuredText("preserve-whitespace").asText();

test("a fresh editor is clean", () => {
  expect(editor.history()).toEqual({ canUndo: false, canRedo: false, dirty: false });
});

test("add text → dirty and undoable; undo/redo toggle the text", async () => {
  const r = await editor.addText(0, [72, 400], "යාපනය", style);
  expect(r.id).toBeTruthy();
  expect(r.history).toEqual({ canUndo: true, canRedo: false, dirty: true });
  expect(text()).toContain("යාපනය");
  editor.undo();
  expect(text()).not.toContain("යාපනය");
  expect(editor.history()).toMatchObject({ canRedo: true, dirty: false });
  editor.redo();
  expect(text()).toContain("යාපනය");
});

test("undo after font embed, more edits, then save still produces a valid file", async () => {
  await editor.addText(0, [72, 400], "කොළඹ", style);
  editor.undo();
  await editor.addText(0, [72, 450], "யாழ்ப்பாணம்", style);
  await editor.addText(0, [72, 500], "ශ්‍රී ලංකාව", { ...style, bold: true });
  const bytes = editor.save();
  expect(text(bytes)).toContain("யாழ்ப்பாணம்");
  expect(text(bytes)).toContain("ශ්‍රී ලංකාව");
  expect(text(bytes)).not.toContain("කොළඹ");
  expect(text(bytes)).toContain("Hello world");
});

test("save then markSaved clears dirty; a later edit makes it dirty again", async () => {
  await editor.addText(0, [72, 400], "Jaffna", style);
  editor.save();
  expect(editor.markSaved().dirty).toBe(false);
  await editor.addText(0, [72, 420], "Galle", style);
  expect(editor.history().dirty).toBe(true);
});

test("edit text, move, delete via the editor", async () => {
  const { id } = await editor.addText(0, [72, 400], "කොළඹ", style);
  await editor.updateText(0, id!, "ගාල්ල", style);
  await editor.moveObject(0, id!, 5, 5);
  expect(editor.listObjects(0)[0]).toMatchObject({ text: "ගාල්ල", origin: [77, 405] });
  await editor.deleteObject(0, id!);
  expect(editor.listObjects(0)).toEqual([]);
  expect(text()).not.toContain("ගාල්ල");
});

test("images: add with default rect, replace by id, delete", async () => {
  const { id } = await editor.addImage(0, png, null);
  expect(editor.listObjects(0)).toHaveLength(1);
  await editor.replaceImage(0, { id: id! }, png);
  await editor.deleteObject(0, id!);
  expect(editor.listObjects(0)).toEqual([]);
});

test("missing characters are reported", async () => {
  const r = await editor.addText(0, [72, 400], "කොළඹ 中", style);
  expect(r.missing).toEqual(["中"]);
});

test("a failing edit is rolled back and leaves history unchanged", async () => {
  await expect(editor.updateText(0, "nope", "x", style)).rejects.toThrow("Unknown object nope");
  expect(editor.history()).toEqual({ canUndo: false, canRedo: false, dirty: false });
});
```

Run: `npx vitest run src/edit/editor.test.ts` → FAIL.

- [ ] **Step 2: Implement editor.ts**

`src/edit/editor.ts`:
```ts
import * as mupdf from "mupdf";
import type { Point, Rect } from "../engine/types";
import { EmbeddedFonts } from "./embedded-fonts";
import { deleteExistingImage, listExistingImages, takeExistingImage } from "./existing-images";
import type { FontRegistry } from "./font-registry";
import {
  addImageObject, addTextObject, defaultImageRect, deleteObject, listObjects, moveObject, replaceObjectImage, resizeObject,
  updateTextObject, type EditContext,
} from "./page-objects";
import { loadStyleFonts, shapeText, type ShapedLine } from "./shaper";
import type { EditResult, ExistingImage, HistoryState, PageObject, TextStyle } from "./types";

/** Edits one PDF document. Every change is one journal operation, so undo/redo cover it. */
export class DocumentEditor {
  private readonly fonts: EmbeddedFonts;
  private savedPosition: number;

  constructor(
    private readonly pdf: mupdf.PDFDocument,
    private readonly registry: FontRegistry,
  ) {
    pdf.enableJournal();
    this.fonts = new EmbeddedFonts(pdf);
    this.savedPosition = pdf.getJournal().position;
  }

  history(): HistoryState {
    return { canUndo: this.pdf.canUndo(), canRedo: this.pdf.canRedo(), dirty: this.pdf.getJournal().position !== this.savedPosition };
  }

  listObjects(page: number): PageObject[] {
    return listObjects(this.pdf.loadPage(page));
  }

  listImages(page: number): ExistingImage[] {
    return listExistingImages(this.pdf.loadPage(page));
  }

  async addText(page: number, origin: Point, text: string, style: TextStyle): Promise<EditResult> {
    const lines = await this.shape(text, style);
    const id = this.op("Add text", page, (ctx) => addTextObject(ctx, origin, text, style, lines));
    return this.result(id, lines);
  }

  async updateText(page: number, id: string, text: string, style: TextStyle): Promise<EditResult> {
    const lines = await this.shape(text, style);
    this.op("Edit text", page, (ctx) => updateTextObject(ctx, id, text, style, lines));
    return this.result(id, lines);
  }

  async moveObject(page: number, id: string, dx: number, dy: number): Promise<EditResult> {
    const object = listObjects(this.pdf.loadPage(page)).find((o) => o.id === id);
    const lines = object?.kind === "text" ? await this.shape(object.text!, object.style!) : [];
    this.op("Move", page, (ctx) => moveObject(ctx, id, dx, dy, () => lines));
    return this.result(id);
  }

  async resizeObject(page: number, id: string, rect: Rect): Promise<EditResult> {
    this.op("Resize", page, (ctx) => resizeObject(ctx, id, rect));
    return this.result(id);
  }

  async deleteObject(page: number, id: string): Promise<EditResult> {
    this.op("Delete", page, (ctx) => deleteObject(ctx, id));
    return this.result();
  }

  async addImage(page: number, bytes: Uint8Array, rect: Rect | null): Promise<EditResult> {
    const image = new mupdf.Image(bytes);
    const id = this.op("Add image", page, (ctx) => addImageObject(ctx, image, rect ?? defaultImageRect(ctx.page.getBounds() as Rect, image)));
    return this.result(id);
  }

  async replaceImage(page: number, target: { id: string } | { rect: Rect }, bytes: Uint8Array): Promise<EditResult> {
    const image = new mupdf.Image(bytes);
    const id = this.op("Replace image", page, (ctx) => {
      if ("id" in target) {
        replaceObjectImage(ctx, target.id, image);
        return target.id;
      }
      deleteExistingImage(ctx.page, target.rect);
      return addImageObject(ctx, image, target.rect);
    });
    return this.result(id);
  }

  async deleteImage(page: number, rect: Rect): Promise<EditResult> {
    this.op("Delete image", page, (ctx) => deleteExistingImage(ctx.page, rect));
    return this.result();
  }

  /** Moves an image from the original content by turning it into a LeoPDF object at the new place. */
  async moveExistingImage(page: number, rect: Rect, dx: number, dy: number): Promise<EditResult> {
    const id = this.op("Move image", page, (ctx) => {
      const image = takeExistingImage(ctx.page, rect);
      return addImageObject(ctx, image, [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy]);
    });
    return this.result(id);
  }

  undo(): EditResult {
    if (this.pdf.canUndo()) this.pdf.undo();
    this.fonts.reset();
    return this.result();
  }

  redo(): EditResult {
    if (this.pdf.canRedo()) this.pdf.redo();
    this.fonts.reset();
    return this.result();
  }

  /** Full rewrite with font subsetting, done on a copy so the journal and open document are untouched. */
  save(): Uint8Array {
    const copy = new mupdf.PDFDocument(this.pdf.saveToBuffer("").asUint8Array());
    try {
      copy.subsetFonts();
      return copy.saveToBuffer("garbage,compress").asUint8Array().slice();
    } finally {
      copy.destroy();
    }
  }

  /** Call after the saved bytes were written successfully. */
  markSaved(): HistoryState {
    this.savedPosition = this.pdf.getJournal().position;
    return this.history();
  }

  private async shape(text: string, style: TextStyle): Promise<ShapedLine[]> {
    return shapeText(text, style, await loadStyleFonts(this.registry, style));
  }

  private op<T>(name: string, page: number, fn: (ctx: EditContext) => T): T {
    const ctx: EditContext = { pdf: this.pdf, page: this.pdf.loadPage(page), fonts: this.fonts };
    this.pdf.beginOperation(name);
    try {
      const value = fn(ctx);
      this.fonts.flush();
      this.pdf.endOperation();
      return value;
    } catch (e) {
      this.pdf.abandonOperation();
      this.fonts.reset();
      throw e;
    }
  }

  private result(id?: string, lines: ShapedLine[] = []): EditResult {
    const missing = [...new Set(lines.flatMap((l) => l.missing))];
    return { history: this.history(), ...(id ? { id } : {}), ...(missing.length ? { missing } : {}) };
  }
}
```

Run: `npx vitest run src/edit/editor.test.ts` → PASS. If `abandonOperation` does not roll back changes already made inside the operation, follow it with `this.pdf.undo()` only when the journal position moved; record as a ruling.

- [ ] **Step 3: Engine integration — failing tests**

Append to `src/engine/document-engine.test.ts`:
```ts
import { nodeFontSource } from "../edit/node-font-source";

test("documents report whether they can be edited and whether they are signed", () => {
  const r = engine.open("a", fixture);
  expect(r.status === "ok" && r.info.editable).toBe(true);
  expect(r.status === "ok" && r.info.signed).toBe(false);
});

test("edits go through the engine and invalidate cached text", async () => {
  const e = new DocumentEngine({ fontSource: nodeFontSource });
  e.open("a", fixture);
  expect(e.search("a", "Jaffna")).toEqual([]);
  const r = await e.addText("a", 0, [72, 400], "Jaffna යාපනය", { family: "sans", bold: false, size: 14, color: [0, 0, 0] });
  expect(r.history.dirty).toBe(true);
  expect(e.search("a", "යාපනය")).toHaveLength(1);
  expect(e.listObjects("a", 0)).toHaveLength(1);
  await e.undo("a");
  expect(e.search("a", "යාපනය")).toEqual([]);
  const saved = e.save("a");
  expect(saved.length).toBeGreaterThan(1000);
  expect(e.markSaved("a").dirty).toBe(false);
});
```

Update `src/engine/lazy-api.test.ts` "exposes every engine method":
```ts
test("exposes every engine method", async () => {
  const { createEngineApi } = await import("./engine-api");
  const api = lazyApi(() => new Promise<EngineApi>(() => {}));
  expect(Object.keys(api).sort()).toEqual(Object.keys(createEngineApi()).sort());
});
```

Run: `npx vitest run src/engine` → FAIL.

- [ ] **Step 4: Implement engine changes**

`src/engine/types.ts` — `DocInfo` gains:
```ts
  /** False for non-PDF documents and PDFs whose permissions forbid editing. */
  editable: boolean;
  /** The PDF contains digital signatures (editing invalidates them). */
  signed: boolean;
```

`src/engine/document-engine.ts` changes:
```ts
import { DocumentEditor } from "../edit/editor";
import { FontRegistry, type FontSource } from "../edit/font-registry";
import type { EditResult, ExistingImage, HistoryState, PageObject, TextStyle } from "../edit/types";
// …
interface OpenDoc {
  doc: mupdf.Document;
  repaired: boolean;
  stext: Map<number, mupdf.StructuredText>;
  prepared: Map<number, PreparedPage>;
  editor: DocumentEditor | null;
}

const noFonts: FontSource = async () => {
  throw new Error("No font source configured");
};

export class DocumentEngine {
  private docs = new Map<string, OpenDoc>();
  private readonly fonts: FontRegistry;

  constructor(options: { fontSource?: FontSource } = {}) {
    this.fonts = new FontRegistry(options.fontSource ?? noFonts);
  }
  // open(): add `editor: null` to the stored OpenDoc.
  // describe(): add to info:
  //   editable: doc.isPDF() && doc.hasPermission("edit"),
  //   signed: isSigned(doc),
```
Add helper:
```ts
function isSigned(doc: mupdf.Document): boolean {
  const pdf = doc.asPDF();
  if (!pdf) return false;
  const flags = pdf.getTrailer().get("Root", "AcroForm", "SigFlags");
  return flags.isNumber() && (flags.asNumber() & 1) === 1;
}
```
Add edit methods (each clears caches via `invalidate`):
```ts
  private editor(docId: string): DocumentEditor {
    const entry = this.get(docId);
    if (!entry.editor) {
      const pdf = entry.doc.asPDF();
      if (!pdf) throw new Error("This document cannot be edited");
      entry.editor = new DocumentEditor(pdf, this.fonts);
    }
    return entry.editor;
  }

  private invalidate(docId: string): void {
    const entry = this.get(docId);
    entry.stext.forEach((st) => st.destroy());
    entry.stext.clear();
    entry.prepared.clear();
  }

  private async edit(docId: string, fn: (editor: DocumentEditor) => Promise<EditResult> | EditResult): Promise<EditResult> {
    const result = await fn(this.editor(docId));
    this.invalidate(docId);
    return result;
  }

  addText = (docId: string, page: number, origin: Point, text: string, style: TextStyle) => this.edit(docId, (e) => e.addText(page, origin, text, style));
  updateText = (docId: string, page: number, id: string, text: string, style: TextStyle) => this.edit(docId, (e) => e.updateText(page, id, text, style));
  moveObject = (docId: string, page: number, id: string, dx: number, dy: number) => this.edit(docId, (e) => e.moveObject(page, id, dx, dy));
  resizeObject = (docId: string, page: number, id: string, rect: Rect) => this.edit(docId, (e) => e.resizeObject(page, id, rect));
  deleteObject = (docId: string, page: number, id: string) => this.edit(docId, (e) => e.deleteObject(page, id));
  addImage = (docId: string, page: number, bytes: Uint8Array, rect: Rect | null) => this.edit(docId, (e) => e.addImage(page, bytes, rect));
  replaceImage = (docId: string, page: number, target: { id: string } | { rect: Rect }, bytes: Uint8Array) => this.edit(docId, (e) => e.replaceImage(page, target, bytes));
  deleteImage = (docId: string, page: number, rect: Rect) => this.edit(docId, (e) => e.deleteImage(page, rect));
  moveExistingImage = (docId: string, page: number, rect: Rect, dx: number, dy: number) => this.edit(docId, (e) => e.moveExistingImage(page, rect, dx, dy));
  undo = (docId: string) => this.edit(docId, (e) => e.undo());
  redo = (docId: string) => this.edit(docId, (e) => e.redo());

  listObjects(docId: string, page: number): PageObject[] {
    return this.get(docId).editor?.listObjects(page) ?? this.editor(docId).listObjects(page);
  }
  listImages(docId: string, page: number): ExistingImage[] {
    return this.editor(docId).listImages(page);
  }
  history(docId: string): HistoryState {
    return this.get(docId).editor?.history() ?? { canUndo: false, canRedo: false, dirty: false };
  }
  save(docId: string): Uint8Array {
    return this.editor(docId).save();
  }
  markSaved(docId: string): HistoryState {
    return this.editor(docId).markSaved();
  }
```
(Import `Rect`, `Point` already present in types import.)

`src/engine/engine-api.ts` — add pass-throughs:
```ts
    addText: (docId: string, page: number, origin: Point, text: string, style: TextStyle) => engine.addText(docId, page, origin, text, style),
    updateText: (docId: string, page: number, id: string, text: string, style: TextStyle) => engine.updateText(docId, page, id, text, style),
    moveObject: (docId: string, page: number, id: string, dx: number, dy: number) => engine.moveObject(docId, page, id, dx, dy),
    resizeObject: (docId: string, page: number, id: string, rect: Rect) => engine.resizeObject(docId, page, id, rect),
    deleteObject: (docId: string, page: number, id: string) => engine.deleteObject(docId, page, id),
    addImage: (docId: string, page: number, bytes: Uint8Array, rect: Rect | null) => engine.addImage(docId, page, bytes, rect),
    replaceImage: (docId: string, page: number, target: { id: string } | { rect: Rect }, bytes: Uint8Array) => engine.replaceImage(docId, page, target, bytes),
    deleteImage: (docId: string, page: number, rect: Rect) => engine.deleteImage(docId, page, rect),
    moveExistingImage: (docId: string, page: number, rect: Rect, dx: number, dy: number) => engine.moveExistingImage(docId, page, rect, dx, dy),
    listObjects: (docId: string, page: number) => engine.listObjects(docId, page),
    listImages: (docId: string, page: number) => engine.listImages(docId, page),
    undo: (docId: string) => engine.undo(docId),
    redo: (docId: string) => engine.redo(docId),
    history: (docId: string) => engine.history(docId),
    save: (docId: string) => {
      const bytes = engine.save(docId);
      return transfer(bytes, [bytes.buffer as ArrayBuffer]);
    },
    markSaved: (docId: string) => engine.markSaved(docId),
```
`createEngineApi(engine = new DocumentEngine())` keeps its default; `worker.ts` becomes:
```ts
import { expose } from "comlink";
import { lazyApi } from "./lazy-api";

// Expose before MuPDF/HarfBuzz finish loading so no early message is lost (see lazy-api.ts).
expose(
  lazyApi(async () => {
    const [{ createEngineApi }, { DocumentEngine }, { fetchFontSource }] = await Promise.all([
      import("./engine-api"),
      import("./document-engine"),
      import("../edit/font-urls"),
    ]);
    return createEngineApi(new DocumentEngine({ fontSource: fetchFontSource }));
  }),
);
```
`lazy-api.ts` — replace the fixed `METHODS` list with one kept in sync by the updated test:
```ts
const METHODS = [
  "open", "unlock", "render", "renderPng", "search", "select", "close",
  "addText", "updateText", "moveObject", "resizeObject", "deleteObject", "addImage", "replaceImage", "deleteImage",
  "moveExistingImage", "listObjects", "listImages", "undo", "redo", "history", "save", "markSaved",
] as const satisfies readonly (keyof EngineApi)[];
```

- [ ] **Step 5: Run tests** — `npm test` → PASS; `npx tsc --noEmit` → clean; `npm run build` → PASS and `dist/assets` contains `harfbuzz` wasm and 12 `.ttf` files.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(engine): document editor with undo/redo and save, exposed through the worker"
```

---

### Task 7: Saving and picking files on disk (Rust + platform)

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`
- Create: `src/platform/files.ts`
- Test: Rust tests in `lib.rs`; `src/platform/files.test.ts`

**Interfaces:**
- Produces (Rust): `write_file` (raw body = bytes, header `x-path` = percent-encoded path; atomic temp+rename; `.pdf` only); `read_image(path)` (`.png/.jpg/.jpeg` only).
- Produces (TS): `ensurePdfName(name): string`, `writePdf(path, bytes): Promise<void>`, `pickSavePath(suggested): Promise<string | null>`, `downloadPdf(name, bytes): void`, `pickImage(): Promise<Uint8Array | null>`.

- [ ] **Step 1: Failing Rust tests + implementation**

```bash
cd src-tauri && cargo add percent-encoding@2 && cd ..
```

Add to `src-tauri/src/lib.rs` (above `#[cfg(test)]`, keep existing code):
```rust
use std::io::Write;
use std::path::Path;

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
```
Register: `tauri::generate_handler![read_file, print_window, take_pending_files, write_file, read_image]`.

Tests (append inside `mod tests`):
```rust
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
```
Capabilities: add `"core:window:allow-destroy"` and `"core:window:allow-close"` to `permissions`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml` → all pass.

- [ ] **Step 2: Failing TS test + implementation**

`src/platform/files.test.ts`:
```ts
import { expect, test } from "vitest";
import { ensurePdfName } from "./files";

test("ensurePdfName adds .pdf when missing", () => {
  expect(ensurePdfName("report")).toBe("report.pdf");
  expect(ensurePdfName("report.PDF")).toBe("report.PDF");
  expect(ensurePdfName("යාපනය.pdf")).toBe("යාපනය.pdf");
});
```

`src/platform/files.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./sources";

export function ensurePdfName(name: string): string {
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

export async function writePdf(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
}

export async function pickSavePath(suggested: string): Promise<string | null> {
  const path = await save({ defaultPath: ensurePdfName(suggested), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return path ? ensurePdfName(path) : null;
}

/** Browser/dev fallback: hand the file to the browser as a download. */
export function downloadPdf(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ensurePdfName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickImage(): Promise<Uint8Array | null> {
  if (isTauri()) {
    const path = await open({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }] });
    if (!path || Array.isArray(path)) return null;
    return new Uint8Array(await invoke<ArrayBuffer>("read_image", { path }));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? new Uint8Array(await file.arrayBuffer()) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
```

Run: `npx vitest run src/platform` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri src/platform
git commit -m "feat(platform): atomic PDF saving, save dialog and image picking"
```

---

### Task 8: Editing strings (en / si / ta)

**Files:**
- Modify: `src/i18n/strings.ts`
- Test: existing `src/i18n/strings.test.ts` (all keys present, placeholders match)

- [ ] **Step 1: Add keys**

Add to `en`:
```ts
  edit: "Edit",
  editPdf: "Edit PDF",
  toolSelectObjects: "Select and move",
  addText: "Add text",
  addImage: "Add image",
  fontFamily: "Font",
  bold: "Bold",
  fontSize: "Font size",
  textColor: "Text colour",
  undo: "Undo",
  redo: "Redo",
  save: "Save",
  saveAs: "Save as…",
  saving: "Saving…",
  saved: "Saved",
  saveFailed: "Could not save “{name}”. Your original file was not changed.",
  unsavedTitle: "Unsaved changes",
  unsavedPrompt: "Save changes to “{name}” before closing?",
  unsavedQuit: "{count} documents have unsaved changes. Save them before quitting?",
  dontSave: "Don't save",
  deleteItem: "Delete",
  replaceImage: "Replace image",
  editNotAllowed: "This PDF's security settings don't allow editing.",
  signedWarning: "This PDF is digitally signed. Editing it will invalidate the signature. Continue?",
  continueAction: "Continue",
  missingGlyphs: "Some characters can't be shown with the bundled fonts: {chars}",
  editFailed: "That edit could not be applied.",
  clickToAddText: "Click on the page to add text",
```
Add to `si` (flag for native review):
```ts
  edit: "සංස්කරණය",
  editPdf: "PDF සංස්කරණය",
  toolSelectObjects: "තෝරා ගෙන චලනය කරන්න",
  addText: "පෙළ එක් කරන්න",
  addImage: "රූපයක් එක් කරන්න",
  fontFamily: "අකුරු",
  bold: "තද",
  fontSize: "අකුරු ප්‍රමාණය",
  textColor: "පෙළ වර්ණය",
  undo: "අහෝසි කරන්න",
  redo: "නැවත කරන්න",
  save: "සුරකින්න",
  saveAs: "වෙනත් නමකින් සුරකින්න…",
  saving: "සුරකිමින්…",
  saved: "සුරකින ලදී",
  saveFailed: "“{name}” සුරැකිය නොහැකි විය. ඔබේ මුල් ගොනුව වෙනස් කර නැත.",
  unsavedTitle: "නොසුරකින ලද වෙනස්කම්",
  unsavedPrompt: "වසා දැමීමට පෙර “{name}” හි වෙනස්කම් සුරකින්නද?",
  unsavedQuit: "ලේඛන {count} ක නොසුරකින ලද වෙනස්කම් ඇත. ඉවත් වීමට පෙර ඒවා සුරකින්නද?",
  dontSave: "සුරකින්න එපා",
  deleteItem: "මකන්න",
  replaceImage: "රූපය ප්‍රතිස්ථාපනය කරන්න",
  editNotAllowed: "මෙම PDF හි ආරක්ෂක සැකසුම් සංස්කරණයට ඉඩ නොදේ.",
  signedWarning: "මෙම PDF ඩිජිටල් ලෙස අත්සන් කර ඇත. සංස්කරණය කිරීමෙන් අත්සන අවලංගු වේ. ඉදිරියට යන්නද?",
  continueAction: "ඉදිරියට යන්න",
  missingGlyphs: "සමහර අක්ෂර ඇතුළත් අකුරු වලින් පෙන්විය නොහැක: {chars}",
  editFailed: "එම සංස්කරණය යෙදිය නොහැකි විය.",
  clickToAddText: "පෙළ එක් කිරීමට පිටුව මත ක්ලික් කරන්න",
```
Add to `ta` (flag for native review):
```ts
  edit: "திருத்து",
  editPdf: "PDF ஐத் திருத்து",
  toolSelectObjects: "தேர்ந்தெடுத்து நகர்த்து",
  addText: "உரையைச் சேர்",
  addImage: "படத்தைச் சேர்",
  fontFamily: "எழுத்துரு",
  bold: "தடித்த",
  fontSize: "எழுத்து அளவு",
  textColor: "உரை நிறம்",
  undo: "செயல்தவிர்",
  redo: "மீண்டும் செய்",
  save: "சேமி",
  saveAs: "இவ்வாறு சேமி…",
  saving: "சேமிக்கிறது…",
  saved: "சேமிக்கப்பட்டது",
  saveFailed: "“{name}” ஐச் சேமிக்க முடியவில்லை. உங்கள் அசல் கோப்பு மாற்றப்படவில்லை.",
  unsavedTitle: "சேமிக்கப்படாத மாற்றங்கள்",
  unsavedPrompt: "மூடுவதற்கு முன் “{name}” இல் உள்ள மாற்றங்களைச் சேமிக்கவா?",
  unsavedQuit: "{count} ஆவணங்களில் சேமிக்கப்படாத மாற்றங்கள் உள்ளன. வெளியேறும் முன் சேமிக்கவா?",
  dontSave: "சேமிக்க வேண்டாம்",
  deleteItem: "நீக்கு",
  replaceImage: "படத்தை மாற்று",
  editNotAllowed: "இந்த PDF இன் பாதுகாப்பு அமைப்புகள் திருத்த அனுமதிக்கவில்லை.",
  signedWarning: "இந்த PDF டிஜிட்டல் முறையில் கையொப்பமிடப்பட்டுள்ளது. திருத்தினால் கையொப்பம் செல்லாததாகிவிடும். தொடரவா?",
  continueAction: "தொடர்",
  missingGlyphs: "சில எழுத்துகளை உள்ளமைந்த எழுத்துருக்களால் காட்ட முடியாது: {chars}",
  editFailed: "அந்தத் திருத்தத்தைப் பயன்படுத்த முடியவில்லை.",
  clickToAddText: "உரையைச் சேர்க்கப் பக்கத்தில் கிளிக் செய்யவும்",
```

- [ ] **Step 2: Run** `npx vitest run src/i18n` → PASS (the existing test checks every key and placeholder in si/ta).

- [ ] **Step 3: Commit**

```bash
git add src/i18n
git commit -m "feat(i18n): editing strings in English, Sinhala and Tamil"
```

---

### Task 9: Edit state in the store

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: `HistoryState`, `TextStyle` (Task 2 types — import type only), `StringKey`.
- Produces on `AppState`:
  - fields: `editMode: boolean`, `editTool: EditTool` (`"select" | "text"`), `textStyle: TextStyle` (default sans, regular, 12pt, black), `selected: Selected | null` where `Selected = { tabId: string; page: number; id: string | null; rect: Rect }` (`id: null` = existing image), `inlineEditor: InlineEditorState | null` where `InlineEditorState = { tabId: string; page: number; origin: Point; objectId: string | null; text: string; style: TextStyle }`, `dialog: DialogState | null` where `DialogState = { kind: "unsaved"; tabIds: string[]; action: "close" | "quit" } | { kind: "signed"; tabId: string }`, `notice: { key: StringKey; vars?: Record<string, string | number> } | null`.
  - `DocTab` fields: `dirty: boolean`, `canUndo: boolean`, `canRedo: boolean`, `revision: number`, `signedAcknowledged: boolean`.
  - actions: `setEditMode(on)`, `setEditTool(tool)`, `setTextStyle(partial)`, `applyHistory(id, history)` (sets dirty/canUndo/canRedo, `revision + 1`, clears search and selection text), `select(selected | null)`, `openInlineEditor(state)`, `closeInlineEditor()`, `setDialog(state | null)`, `acknowledgeSigned(id)`, `markSaved(id, path | null, history)` (updates path/key/name when a new path is given), `showNotice(key, vars?)`, `clearNotice()`.

- [ ] **Step 1: Failing tests** — append to `src/state/store.test.ts`:
```ts
test("edit history updates flags, bumps the revision and clears search", () => {
  const { store, id, tab } = storeWithDoc(3);
  store.getState().setSearchResults(id, "", []);
  store.getState().startSearch(id, "x");
  store.getState().applyHistory(id, { canUndo: true, canRedo: false, dirty: true });
  expect(tab()).toMatchObject({ dirty: true, canUndo: true, canRedo: false, revision: 1 });
  expect(tab().search.query).toBe("");
});

test("markSaved clears dirty and adopts a new path", () => {
  const { store, id, tab } = storeWithDoc(3);
  store.getState().applyHistory(id, { canUndo: true, canRedo: false, dirty: true });
  store.getState().markSaved(id, "/docs/යාපනය.pdf", { canUndo: true, canRedo: false, dirty: false });
  expect(tab()).toMatchObject({ dirty: false, path: "/docs/යාපනය.pdf", key: "/docs/යාපනය.pdf", name: "යාපනය.pdf" });
  expect(store.getState().recent[0].path).toBe("/docs/යාපනය.pdf");
});

test("text style merges partial updates", () => {
  const { store } = storeWithDoc();
  store.getState().setTextStyle({ bold: true, size: 18 });
  expect(store.getState().textStyle).toEqual({ family: "sans", bold: true, size: 18, color: [0, 0, 0] });
});

test("leaving edit mode closes the inline editor and clears selection", () => {
  const { store, id } = storeWithDoc();
  store.getState().setEditMode(true);
  store.getState().select({ tabId: id, page: 0, id: "t1", rect: [0, 0, 1, 1] });
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [1, 1], objectId: null, text: "", style: store.getState().textStyle });
  store.getState().setEditMode(false);
  expect(store.getState()).toMatchObject({ editMode: false, selected: null, inlineEditor: null, editTool: "select" });
});
```
Run: `npx vitest run src/state` → FAIL.

- [ ] **Step 2: Implement** in `src/state/store.ts`:
  - Add the types listed under Interfaces (import `HistoryState`, `TextStyle` with `import type` from `../edit/types`, `Point`, `Rect` from `../engine/types`, `baseName` from `../platform/sources`).
  - New tabs get `dirty: false, canUndo: false, canRedo: false, revision: 0, signedAcknowledged: false`.
  - Initial state: `editMode: false, editTool: "select", textStyle: { family: "sans", bold: false, size: 12, color: [0, 0, 0] }, selected: null, inlineEditor: null, dialog: null, notice: null`.
  - Actions:
```ts
      setEditMode: (editMode) => set(editMode ? { editMode } : { editMode, editTool: "select", selected: null, inlineEditor: null }),
      setEditTool: (editTool) => set({ editTool, selected: null }),
      setTextStyle: (partial) => set((s) => ({ textStyle: { ...s.textStyle, ...partial } })),
      applyHistory: (id, history) =>
        update(id, (t) => ({ dirty: history.dirty, canUndo: history.canUndo, canRedo: history.canRedo, revision: t.revision + 1, search: EMPTY_SEARCH, selection: null })),
      select: (selected) => set({ selected }),
      openInlineEditor: (inlineEditor) => set({ inlineEditor, selected: null }),
      closeInlineEditor: () => set({ inlineEditor: null }),
      setDialog: (dialog) => set({ dialog }),
      acknowledgeSigned: (id) => update(id, () => ({ signedAcknowledged: true })),
      markSaved(id, path, history) {
        update(id, (t) => ({
          dirty: history.dirty,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          ...(path && path !== t.path ? { path, key: path, name: baseName(path) } : {}),
        }));
        if (path) get().pushRecent(path);
      },
      showNotice: (key, vars) => set({ notice: { key, vars } }),
      clearNotice: () => set({ notice: null }),
```
- [ ] **Step 3: Run** `npx vitest run src/state` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `git commit -m "feat(state): edit mode, tool, style, history and dialogs"` (after `git add src/state`).

---

### Task 10: Edit orchestration and the save / close / quit flow

**Files:**
- Create: `src/app/edit-actions.ts`
- Modify: `src/app/TabBar.tsx`, `src/app/useShortcuts.ts` (close via `requestClose`)
- Test: `src/app/edit-actions.test.ts`

**Interfaces:**
- Consumes: store actions (Task 9), engine methods (Task 6), `writePdf`, `pickSavePath`, `downloadPdf`, `pickImage` (Task 7), `isTauri`, `closeDocument` (existing).
- Produces:
  - `interface EditDeps { engine: EditEngine; store: AppStore; files: { writePdf; pickSavePath; downloadPdf; pickImage }; tauri: boolean }` with `defaultEditDeps()`.
  - `runEdit(tabId, call, deps?) → Promise<EditResult | null>` (applies history, shows `missingGlyphs`/`editFailed` notices).
  - `commitInlineEditor(deps?)`, `addImageFromPicker(tabId, page, deps?)`, `deleteSelected(deps?)`, `undo(tabId, deps?)`, `redo(tabId, deps?)`.
  - `saveTab(tabId, { as }, deps?) → Promise<boolean>`.
  - `requestClose(tabId, deps?)`, `requestQuit(deps?) → boolean` (true = may quit now), `resolveDialog(choice: "save" | "discard" | "cancel", deps?)`, `enterEditMode(deps?)`.

- [ ] **Step 1: Failing tests**

`src/app/edit-actions.test.ts`:
```ts
import { expect, test, vi } from "vitest";
import type { EditResult, HistoryState } from "../edit/types";
import type { DocInfo } from "../engine/types";
import { createAppStore, getTab } from "../state/store";
import { commitInlineEditor, enterEditMode, requestClose, requestQuit, resolveDialog, saveTab, type EditDeps } from "./edit-actions";

const clean: HistoryState = { canUndo: false, canRedo: false, dirty: false };
const dirty: HistoryState = { canUndo: true, canRedo: false, dirty: true };
const info = (over: Partial<DocInfo> = {}): DocInfo => ({
  pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false, ...over,
});

function setup(path: string | null = "/docs/a.pdf", docInfo = info()) {
  const store = createAppStore({ lang: "en", theme: "system", recent: [] });
  const { id } = store.getState().addTab({ key: path ?? "web:a", name: "a.pdf", path });
  store.getState().setOpenResult(id, { status: "ok", info: docInfo });
  const engine = {
    addText: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "t1" })),
    updateText: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "t1" })),
    deleteObject: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    deleteImage: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    addImage: vi.fn(async (): Promise<EditResult> => ({ history: dirty, id: "i1" })),
    undo: vi.fn(async (): Promise<EditResult> => ({ history: clean })),
    redo: vi.fn(async (): Promise<EditResult> => ({ history: dirty })),
    save: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    markSaved: vi.fn(async () => clean),
    close: vi.fn(async () => undefined),
  };
  const files = {
    writePdf: vi.fn(async () => undefined),
    pickSavePath: vi.fn(async (): Promise<string | null> => "/docs/new.pdf"),
    downloadPdf: vi.fn(),
    pickImage: vi.fn(async (): Promise<Uint8Array | null> => new Uint8Array([1])),
  };
  const deps = { engine, store, files, tauri: true } as unknown as EditDeps;
  return { store, id, engine, files, deps, tab: () => getTab(store.getState(), id)! };
}

test("committing the inline editor adds text and marks the tab dirty", async () => {
  const { store, id, engine, deps, tab } = setup();
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [10, 20], objectId: null, text: "යාපනය", style: store.getState().textStyle });
  await commitInlineEditor(deps);
  expect(engine.addText).toHaveBeenCalledWith(id, 0, [10, 20], "යාපනය", store.getState().textStyle);
  expect(tab()).toMatchObject({ dirty: true, revision: 1 });
  expect(store.getState().inlineEditor).toBeNull();
});

test("committing empty text for an existing object deletes it; for a new one does nothing", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [10, 20], objectId: "t1", text: "  ", style: store.getState().textStyle });
  await commitInlineEditor(deps);
  expect(engine.deleteObject).toHaveBeenCalledWith(id, 0, "t1");
  store.getState().openInlineEditor({ tabId: id, page: 0, origin: [10, 20], objectId: null, text: "", style: store.getState().textStyle });
  await commitInlineEditor(deps);
  expect(engine.addText).not.toHaveBeenCalled();
});

test("save writes to the tab's path and clears dirty", async () => {
  const { id, engine, files, deps, tab, store } = setup();
  store.getState().applyHistory(id, dirty);
  expect(await saveTab(id, { as: false }, deps)).toBe(true);
  expect(files.writePdf).toHaveBeenCalledWith("/docs/a.pdf", expect.any(Uint8Array));
  expect(engine.markSaved).toHaveBeenCalledWith(id);
  expect(tab().dirty).toBe(false);
});

test("save failure: nothing marked saved, tab stays dirty, notice shown", async () => {
  const { id, engine, files, deps, tab, store } = setup();
  store.getState().applyHistory(id, dirty);
  files.writePdf.mockRejectedValueOnce(new Error("read-only"));
  expect(await saveTab(id, { as: false }, deps)).toBe(false);
  expect(engine.markSaved).not.toHaveBeenCalled();
  expect(tab().dirty).toBe(true);
  expect(store.getState().notice?.key).toBe("saveFailed");
});

test("save as asks for a path and adopts it; cancelling the dialog saves nothing", async () => {
  const { id, files, deps, tab } = setup();
  await saveTab(id, { as: true }, deps);
  expect(tab().path).toBe("/docs/new.pdf");
  files.pickSavePath.mockResolvedValueOnce(null);
  expect(await saveTab(id, { as: true }, deps)).toBe(false);
});

test("browser tabs download on save", async () => {
  const { id, files, deps } = setup(null);
  (deps as { tauri: boolean }).tauri = false;
  await saveTab(id, { as: false }, deps);
  expect(files.downloadPdf).toHaveBeenCalledWith("a.pdf", expect.any(Uint8Array));
});

test("closing a dirty tab asks first; discard closes, cancel keeps it", async () => {
  const { store, id, engine, deps } = setup();
  store.getState().applyHistory(id, dirty);
  await requestClose(id, deps);
  expect(store.getState().dialog).toEqual({ kind: "unsaved", tabIds: [id], action: "close" });
  await resolveDialog("cancel", deps);
  expect(store.getState().tabs).toHaveLength(1);
  await requestClose(id, deps);
  await resolveDialog("discard", deps);
  expect(store.getState().tabs).toHaveLength(0);
  expect(engine.close).toHaveBeenCalledWith(id);
});

test("save in the unsaved dialog saves then closes", async () => {
  const { store, id, files, deps } = setup();
  store.getState().applyHistory(id, dirty);
  await requestClose(id, deps);
  await resolveDialog("save", deps);
  expect(files.writePdf).toHaveBeenCalled();
  expect(store.getState().tabs).toHaveLength(0);
});

test("quitting with dirty tabs asks; clean state may quit immediately", async () => {
  const { store, id, deps } = setup();
  expect(requestQuit(deps)).toBe(true);
  store.getState().applyHistory(id, dirty);
  expect(requestQuit(deps)).toBe(false);
  expect(store.getState().dialog).toEqual({ kind: "unsaved", tabIds: [id], action: "quit" });
});

test("entering edit mode: disallowed PDFs show a notice; signed PDFs ask once", async () => {
  const locked = setup("/a.pdf", info({ editable: false }));
  await enterEditMode(locked.deps);
  expect(locked.store.getState()).toMatchObject({ editMode: false, notice: { key: "editNotAllowed" } });
  const signed = setup("/b.pdf", info({ signed: true }));
  await enterEditMode(signed.deps);
  expect(signed.store.getState().dialog).toEqual({ kind: "signed", tabId: signed.id });
  await resolveDialog("save", signed.deps); // "Continue" maps to the primary choice
  expect(signed.store.getState().editMode).toBe(true);
  expect(signed.tab().signedAcknowledged).toBe(true);
});
```
Run: `npx vitest run src/app/edit-actions.test.ts` → FAIL.

- [ ] **Step 2: Implement edit-actions.ts**

`src/app/edit-actions.ts`:
```ts
import { getEngine } from "../engine/client";
import type { EngineApi } from "../engine/engine-api";
import type { EditResult } from "../edit/types";
import { downloadPdf, pickImage, pickSavePath, writePdf } from "../platform/files";
import { isTauri } from "../platform/sources";
import { activeTab, appStore, getTab, type AppStore } from "../state/store";
import { closeDocument } from "./open-document";

type Async<T> = T extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;
export type EditEngine = { [K in keyof EngineApi]: Async<EngineApi[K]> };

export interface EditDeps {
  engine: EditEngine;
  store: AppStore;
  files: { writePdf: typeof writePdf; pickSavePath: typeof pickSavePath; downloadPdf: typeof downloadPdf; pickImage: typeof pickImage };
  tauri: boolean;
}

export const defaultEditDeps = (): EditDeps => ({
  engine: getEngine() as unknown as EditEngine,
  store: appStore,
  files: { writePdf, pickSavePath, downloadPdf, pickImage },
  tauri: isTauri(),
});

export async function runEdit(tabId: string, call: () => Promise<EditResult>, deps: EditDeps = defaultEditDeps()): Promise<EditResult | null> {
  const s = deps.store.getState();
  try {
    const result = await call();
    s.applyHistory(tabId, result.history);
    if (result.missing?.length) s.showNotice("missingGlyphs", { chars: result.missing.join(" ") });
    return result;
  } catch {
    s.showNotice("editFailed");
    return null;
  }
}

export async function commitInlineEditor(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const ed = s.inlineEditor;
  if (!ed) return;
  s.closeInlineEditor();
  const empty = ed.text.trim().length === 0;
  if (ed.objectId) {
    await runEdit(ed.tabId, () => (empty ? deps.engine.deleteObject(ed.tabId, ed.page, ed.objectId!) : deps.engine.updateText(ed.tabId, ed.page, ed.objectId!, ed.text, ed.style)), deps);
  } else if (!empty) {
    await runEdit(ed.tabId, () => deps.engine.addText(ed.tabId, ed.page, ed.origin, ed.text, ed.style), deps);
  }
}

export async function addImageFromPicker(tabId: string, page: number, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const bytes = await deps.files.pickImage();
  if (bytes) await runEdit(tabId, () => deps.engine.addImage(tabId, page, bytes, null), deps);
}

export async function replaceSelectedImage(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const sel = deps.store.getState().selected;
  if (!sel) return;
  const bytes = await deps.files.pickImage();
  if (!bytes) return;
  const target = sel.id ? { id: sel.id } : { rect: sel.rect };
  await runEdit(sel.tabId, () => deps.engine.replaceImage(sel.tabId, sel.page, target, bytes), deps);
}

export async function deleteSelected(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const sel = s.selected;
  if (!sel) return;
  s.select(null);
  await runEdit(sel.tabId, () => (sel.id ? deps.engine.deleteObject(sel.tabId, sel.page, sel.id) : deps.engine.deleteImage(sel.tabId, sel.page, sel.rect)), deps);
}

export const undo = (tabId: string, deps: EditDeps = defaultEditDeps()) => runEdit(tabId, () => deps.engine.undo(tabId), deps);
export const redo = (tabId: string, deps: EditDeps = defaultEditDeps()) => runEdit(tabId, () => deps.engine.redo(tabId), deps);

export async function saveTab(tabId: string, { as }: { as: boolean }, deps: EditDeps = defaultEditDeps()): Promise<boolean> {
  const s = deps.store.getState();
  const tab = getTab(s, tabId);
  if (!tab) return false;
  let path: string | null = null;
  if (deps.tauri) {
    path = !as && tab.path ? tab.path : await deps.files.pickSavePath(tab.name);
    if (!path) return false;
  }
  s.showNotice("saving");
  try {
    const bytes = await deps.engine.save(tabId);
    if (path) await deps.files.writePdf(path, bytes);
    else deps.files.downloadPdf(tab.name, bytes);
    const history = await deps.engine.markSaved(tabId);
    s.markSaved(tabId, path, history);
    s.showNotice("saved");
    return true;
  } catch {
    s.showNotice("saveFailed", { name: tab.name });
    return false;
  }
}

export async function requestClose(tabId: string, deps: EditDeps = defaultEditDeps()): Promise<void> {
  const tab = getTab(deps.store.getState(), tabId);
  if (tab?.dirty) deps.store.getState().setDialog({ kind: "unsaved", tabIds: [tabId], action: "close" });
  else await closeDocument(tabId, deps.store, deps.engine);
}

/** Returns true if the app may quit now; otherwise opens the unsaved-changes dialog. */
export function requestQuit(deps: EditDeps = defaultEditDeps()): boolean {
  const dirty = deps.store.getState().tabs.filter((t) => t.dirty).map((t) => t.id);
  if (dirty.length === 0) return true;
  deps.store.getState().setDialog({ kind: "unsaved", tabIds: dirty, action: "quit" });
  return false;
}

/** Hook for the quit action, set by App (Tauri window destroy / browser no-op). */
export const quitHandler = { quit: () => {} };

export async function resolveDialog(choice: "save" | "discard" | "cancel", deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const dialog = s.dialog;
  s.setDialog(null);
  if (!dialog || choice === "cancel") return;
  if (dialog.kind === "signed") {
    s.acknowledgeSigned(dialog.tabId);
    s.setEditMode(true);
    return;
  }
  if (choice === "save") {
    for (const id of dialog.tabIds) if (!(await saveTab(id, { as: false }, deps))) return;
  }
  if (dialog.action === "close") for (const id of dialog.tabIds) await closeDocument(id, deps.store, deps.engine);
  else quitHandler.quit();
}

export async function enterEditMode(deps: EditDeps = defaultEditDeps()): Promise<void> {
  const s = deps.store.getState();
  const tab = activeTab(s);
  if (!tab?.info) return;
  if (!tab.info.editable) {
    s.showNotice("editNotAllowed");
    return;
  }
  if (tab.info.signed && !tab.signedAcknowledged) {
    s.setDialog({ kind: "signed", tabId: tab.id });
    return;
  }
  s.setEditMode(true);
}
```
Also: `TabBar.tsx` close buttons and `useShortcuts.ts` `w` action call `requestClose(tab.id)` instead of `closeDocument`.

- [ ] **Step 3: Run** `npm test` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `git add src/app && git commit -m "feat(app): edit orchestration, atomic save and unsaved-changes guards"`.

---

### Task 11: Edit toggle, edit bar and shortcuts

**Files:**
- Create: `src/app/EditBar.tsx`, `src/app/ConfirmDialog.tsx`, `src/app/EditBar.test.tsx`
- Modify: `src/app/Toolbar.tsx`, `src/app/useShortcuts.ts`, `src/app/App.tsx`, `src/app/app.css`, `src/main.tsx` (serif @fontsource imports)

**Interfaces:**
- Consumes: store (Task 9), edit-actions (Task 10), `useT`.
- Produces: `EditBar({ tab })`, `ConfirmDialog()` (renders `store.dialog`), `Notice()` toast for `store.notice` (auto-clears after 2.5 s except `saving`).

- [ ] **Step 1: Failing UI test**

`src/app/EditBar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appStore, getTab } from "../state/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditBar } from "./EditBar";

let id: string;
beforeEach(() => {
  appStore.setState({ tabs: [], activeId: null, lang: "en", editMode: true, editTool: "select", dialog: null });
  id = appStore.getState().addTab({ key: "/a.pdf", name: "a.pdf", path: "/a.pdf" }).id;
  appStore.getState().setOpenResult(id, {
    status: "ok",
    info: { pageCount: 1, pages: [{ bounds: [0, 0, 600, 800], label: "1" }], outline: [], title: null, repaired: false, editable: true, signed: false },
  });
});
afterEach(cleanup);

test("edit bar switches tools and style", () => {
  render(<EditBar tab={getTab(appStore.getState(), id)!} />);
  fireEvent.click(screen.getByLabelText("Add text"));
  expect(appStore.getState().editTool).toBe("text");
  fireEvent.click(screen.getByLabelText("Bold"));
  expect(appStore.getState().textStyle.bold).toBe(true);
  fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "20" } });
  expect(appStore.getState().textStyle.size).toBe(20);
  expect((screen.getByLabelText("Undo") as HTMLButtonElement).disabled).toBe(true);
});

test("unsaved dialog shows the file name and three choices", () => {
  appStore.getState().setDialog({ kind: "unsaved", tabIds: [id], action: "close" });
  render(<ConfirmDialog />);
  expect(screen.getByText("Save changes to “a.pdf” before closing?")).toBeTruthy();
  expect(screen.getByText("Save")).toBeTruthy();
  expect(screen.getByText("Don't save")).toBeTruthy();
  expect(screen.getByText("Cancel")).toBeTruthy();
});
```
Run → FAIL.

- [ ] **Step 2: Implement**

`src/main.tsx` — add after the existing font imports:
```tsx
import "@fontsource/noto-sans/700.css";
import "@fontsource/noto-sans-sinhala/700.css";
import "@fontsource/noto-sans-tamil/700.css";
import "@fontsource/noto-serif/400.css";
import "@fontsource/noto-serif/700.css";
import "@fontsource/noto-serif-sinhala/400.css";
import "@fontsource/noto-serif-sinhala/700.css";
import "@fontsource/noto-serif-tamil/400.css";
import "@fontsource/noto-serif-tamil/700.css";
```

`src/app/EditBar.tsx`:
```tsx
import { Bold, ImagePlus, MousePointer2, Redo2, Save, Type, Undo2 } from "lucide-react";
import { useT } from "../i18n/useT";
import { useApp, type DocTab } from "../state/store";
import { addImageFromPicker, redo, saveTab, undo } from "./edit-actions";

const toHex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export function EditBar({ tab }: { tab: DocTab }) {
  const t = useT();
  const tool = useApp((s) => s.editTool);
  const style = useApp((s) => s.textStyle);
  const setTool = useApp((s) => s.setEditTool);
  const setStyle = useApp((s) => s.setTextStyle);
  return (
    <div className="editbar" role="toolbar" aria-label={t("editPdf")}>
      <button className={`icon-button ${tool === "select" ? "pressed" : ""}`} aria-label={t("toolSelectObjects")} title={t("toolSelectObjects")} onClick={() => setTool("select")}>
        <MousePointer2 size={18} />
      </button>
      <button className={`icon-button ${tool === "text" ? "pressed" : ""}`} aria-label={t("addText")} title={t("addText")} onClick={() => setTool("text")}>
        <Type size={18} />
      </button>
      <button className="icon-button" aria-label={t("addImage")} title={t("addImage")} onClick={() => void addImageFromPicker(tab.id, tab.currentPage)}>
        <ImagePlus size={18} />
      </button>
      <div className="separator" />
      <select aria-label={t("fontFamily")} title={t("fontFamily")} value={style.family} onChange={(e) => setStyle({ family: e.target.value as "sans" | "serif" })}>
        <option value="sans">Noto Sans</option>
        <option value="serif">Noto Serif</option>
      </select>
      <input
        className="size-input"
        type="number"
        min={4}
        max={144}
        aria-label={t("fontSize")}
        title={t("fontSize")}
        value={style.size}
        onChange={(e) => {
          const size = Number(e.target.value);
          if (Number.isFinite(size) && size >= 4 && size <= 144) setStyle({ size });
        }}
      />
      <button className={`icon-button ${style.bold ? "pressed" : ""}`} aria-label={t("bold")} aria-pressed={style.bold} title={t("bold")} onClick={() => setStyle({ bold: !style.bold })}>
        <Bold size={18} />
      </button>
      <input type="color" aria-label={t("textColor")} title={t("textColor")} value={toHex(style.color)} onChange={(e) => setStyle({ color: fromHex(e.target.value) })} />
      <div className="separator" />
      <button className="icon-button" aria-label={t("undo")} title={t("undo")} disabled={!tab.canUndo} onClick={() => void undo(tab.id)}>
        <Undo2 size={18} />
      </button>
      <button className="icon-button" aria-label={t("redo")} title={t("redo")} disabled={!tab.canRedo} onClick={() => void redo(tab.id)}>
        <Redo2 size={18} />
      </button>
      <div className="spacer" />
      {tool === "text" && <span className="muted">{t("clickToAddText")}</span>}
      <button className="primary-button" onClick={() => void saveTab(tab.id, { as: false })}>
        <Save size={16} /> {t("save")}
      </button>
    </div>
  );
}
```

`src/app/ConfirmDialog.tsx`:
```tsx
import { useT } from "../i18n/useT";
import { getTab, useApp } from "../state/store";
import { resolveDialog } from "./edit-actions";

export function ConfirmDialog() {
  const t = useT();
  const dialog = useApp((s) => s.dialog);
  const tabs = useApp((s) => s.tabs);
  if (!dialog) return null;
  let title = t("unsavedTitle");
  let message: string;
  let primary = t("save");
  let showDiscard = true;
  if (dialog.kind === "signed") {
    title = t("editPdf");
    message = t("signedWarning");
    primary = t("continueAction");
    showDiscard = false;
  } else if (dialog.action === "quit" && dialog.tabIds.length > 1) {
    message = t("unsavedQuit", { count: dialog.tabIds.length });
  } else {
    message = t("unsavedPrompt", { name: getTab({ tabs } as never, dialog.tabIds[0])?.name ?? "" });
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="doc-message">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="form-actions">
          <button onClick={() => void resolveDialog("cancel")}>{t("cancel")}</button>
          {showDiscard && <button onClick={() => void resolveDialog("discard")}>{t("dontSave")}</button>}
          <button className="primary-button" onClick={() => void resolveDialog("save")}>
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}
```

`Toolbar.tsx` — after the hand tool button add the Edit toggle:
```tsx
      <IconButton
        label={tab?.info && !tab.info.editable ? t("editNotAllowed") : t("editPdf")}
        pressed={s.editMode}
        disabled={!ready}
        onClick={() => (s.editMode ? s.setEditMode(false) : void enterEditMode())}
      >
        <PenLine size={18} />
      </IconButton>
```
(import `PenLine` from lucide-react and `enterEditMode` from `./edit-actions`).

`useShortcuts.ts` — inside the `mod` actions map add (and route `w` through `requestClose`):
```ts
          z: ready ? () => void (e.shiftKey ? redo(tab.id) : undo(tab.id)) : undefined,
          y: ready ? () => void redo(tab.id) : undefined,
          s: ready ? () => void saveTab(tab.id, { as: e.shiftKey }) : undefined,
```
and outside `mod`, before the page keys:
```ts
      if ((e.key === "Delete" || e.key === "Backspace") && s.editMode && s.selected && !inField) {
        e.preventDefault();
        void deleteSelected();
        return;
      }
```

`App.tsx`:
  - Render `{tab?.status === "ready" && editMode && <EditBar tab={tab} />}` directly below `<Toolbar …/>`, `<ConfirmDialog />` and `<Notice />` near the end.
  - `Notice` (in `App.tsx`):
```tsx
function Notice() {
  const t = useT();
  const notice = useApp((s) => s.notice);
  const clear = useApp((s) => s.clearNotice);
  useEffect(() => {
    if (!notice || notice.key === "saving") return;
    const timer = setTimeout(clear, 2500);
    return () => clearTimeout(timer);
  }, [notice, clear]);
  return notice ? <div className="toast">{t(notice.key, notice.vars)}</div> : null;
}
```
  - Quit guard effect (Tauri) and browser `beforeunload`:
```tsx
  useEffect(() => {
    if (!isTauri()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (appStore.getState().tabs.some((t) => t.dirty)) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      quitHandler.quit = () => void win.destroy();
      void win
        .onCloseRequested((event) => {
          if (!requestQuit()) event.preventDefault();
        })
        .then((u) => (disposed ? u() : (unlisten = u)));
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
```
  - The existing `copied` toast stays.

`app.css` additions:
```css
.editbar { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: var(--accent-soft); border-bottom: 1px solid var(--border); }
.editbar select, .size-input { height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); padding: 0 6px; }
.size-input { width: 56px; }
.editbar input[type="color"] { width: 32px; height: 28px; border: 1px solid var(--border); border-radius: 6px; padding: 0; background: none; }
.modal-backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.35); z-index: 20; }
.modal-backdrop h2 { margin-top: 0; font-size: 17px; }
```

- [ ] **Step 3: Run** `npm test` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `git add src && git commit -m "feat(app): Edit toggle, edit bar, dialogs and editing shortcuts"`.

---

### Task 12: Edit layer and inline text editor

**Files:**
- Create: `src/viewer/InlineTextEditor.tsx`, `src/viewer/EditLayer.tsx`, `src/viewer/InlineTextEditor.test.tsx`
- Modify: `src/viewer/PageSlot.tsx`, `src/viewer/PageCanvas.tsx`, `src/app/app.css`

**Interfaces:**
- Consumes: `PageTransform` (`pageTransform`), store (Task 9), edit-actions (Task 10), engine `listObjects`/`listImages`/`moveObject`/`resizeObject`/`moveExistingImage`.
- Produces: `InlineTextEditor({ state, transform, zoom, onCommit, onCancel, onChange })`; `EditLayer({ tab, page, transform })`; `PageCanvas` takes `revision` and re-renders when it changes.

- [ ] **Step 1: Failing test**

`src/viewer/InlineTextEditor.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { pageTransform } from "./geometry";
import { InlineTextEditor } from "./InlineTextEditor";

afterEach(cleanup);
const state = { tabId: "d", page: 0, origin: [100, 200] as [number, number], objectId: null, text: "", style: { family: "sans" as const, bold: false, size: 12, color: [0, 0, 0] as [number, number, number] } };

test("typing updates text; Cmd/Ctrl+Enter commits; Escape cancels; Enter adds a line", () => {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onChange = vi.fn();
  render(<InlineTextEditor state={state} transform={pageTransform([0, 0, 600, 800], 2, 0)} zoom={2} onCommit={onCommit} onCancel={onCancel} onChange={onChange} />);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "යාපනය" } });
  expect(onChange).toHaveBeenCalledWith("යාපනය");
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  expect(onCommit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("editor is placed at the baseline in display coordinates, with matching font size", () => {
  render(<InlineTextEditor state={state} transform={pageTransform([0, 0, 600, 800], 2, 0)} zoom={2} onCommit={vi.fn()} onCancel={vi.fn()} onChange={vi.fn()} />);
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(box.style.left).toBe("200px");
  expect(box.style.fontSize).toBe("24px");
});
```
Run → FAIL.

- [ ] **Step 2: Implement InlineTextEditor.tsx**

```tsx
import { useEffect, useRef } from "react";
import type { InlineEditorState } from "../state/store";
import type { PageTransform } from "./geometry";

const FAMILIES = {
  sans: '"Noto Sans", "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif',
  serif: '"Noto Serif", "Noto Serif Sinhala", "Noto Serif Tamil", serif',
};

interface Props {
  state: InlineEditorState;
  transform: PageTransform;
  zoom: number;
  onChange(text: string): void;
  onCommit(): void;
  onCancel(): void;
}

/** A textarea laid over the page where the text will be written; the browser shapes it with the same Noto fonts. */
export function InlineTextEditor({ state, transform, zoom, onChange, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { style } = state;
  const [x, y] = transform.toDisplay(state.origin);
  const fontSize = style.size * zoom;
  const lines = Math.max(1, state.text.split("\n").length);

  useEffect(() => ref.current?.focus(), []);

  return (
    <textarea
      ref={ref}
      className="inline-editor"
      value={state.text}
      rows={lines}
      spellCheck={false}
      style={{
        left: x,
        top: y - fontSize * 1.05,
        fontSize,
        lineHeight: 1.4,
        fontFamily: FAMILIES[style.family],
        fontWeight: style.bold ? 700 : 400,
        color: `rgb(${style.color.map((c) => Math.round(c * 255)).join(",")})`,
      }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit();
        }
      }}
      onBlur={onCommit}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
```
Add `onChange` support to the store: `updateInlineText(text)` action that sets `inlineEditor.text` (add to Task 9's store in this task; small).

- [ ] **Step 3: Implement EditLayer.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { getEngine } from "../engine/client";
import type { Point, Rect } from "../engine/types";
import type { ExistingImage, PageObject } from "../edit/types";
import { commitInlineEditor, replaceSelectedImage, runEdit } from "../app/edit-actions";
import { useT } from "../i18n/useT";
import { appStore, useApp, type DocTab } from "../state/store";
import type { PageTransform } from "./geometry";
import { InlineTextEditor } from "./InlineTextEditor";

interface Frame {
  id: string | null;
  kind: "text" | "image";
  rect: Rect;
  object?: PageObject;
}

type Drag = { frame: Frame; start: Point; mode: "move" | "resize"; delta: Point } | null;

export function EditLayer({ tab, page, transform, zoom }: { tab: DocTab; page: number; transform: PageTransform; zoom: number }) {
  const t = useT();
  const tool = useApp((s) => s.editTool);
  const selected = useApp((s) => s.selected);
  const editor = useApp((s) => s.inlineEditor);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [drag, setDrag] = useState<Drag>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getEngine().listObjects(tab.id, page), getEngine().listImages(tab.id, page)]).then(([objects, images]: [PageObject[], ExistingImage[]]) => {
      if (cancelled) return;
      setFrames([
        ...images.map((img) => ({ id: null, kind: "image" as const, rect: img.rect })),
        ...objects.map((o) => ({ id: o.id, kind: o.kind, rect: o.rect, object: o })),
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.id, page, tab.revision]);

  const pagePoint = (e: React.PointerEvent): Point => {
    const box = layer.current!.getBoundingClientRect();
    return transform.toPage([e.clientX - box.left, e.clientY - box.top]);
  };

  const onLayerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== layer.current) return;
    const s = appStore.getState();
    if (s.inlineEditor) {
      void commitInlineEditor();
      return;
    }
    if (tool === "text") s.openInlineEditor({ tabId: tab.id, page, origin: pagePoint(e), objectId: null, text: "", style: s.textStyle });
    else s.select(null);
  };

  const onFrameDown = (frame: Frame, mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    appStore.getState().select({ tabId: tab.id, page, id: frame.id, rect: frame.rect });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ frame, start: pagePoint(e), mode, delta: [0, 0] });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pagePoint(e);
    setDrag({ ...drag, delta: [p[0] - drag.start[0], p[1] - drag.start[1]] });
  };

  const onUp = () => {
    if (!drag) return;
    const { frame, delta, mode } = drag;
    setDrag(null);
    if (Math.hypot(delta[0], delta[1]) < 1) return;
    const engine = getEngine();
    if (mode === "resize" && frame.id) {
      const rect: Rect = [frame.rect[0], frame.rect[1], Math.max(frame.rect[0] + 8, frame.rect[2] + delta[0]), Math.max(frame.rect[1] + 8, frame.rect[3] + delta[1])];
      void runEdit(tab.id, () => engine.resizeObject(tab.id, page, frame.id!, rect));
    } else if (frame.id) {
      void runEdit(tab.id, () => engine.moveObject(tab.id, page, frame.id!, delta[0], delta[1]));
    } else {
      void runEdit(tab.id, () => engine.moveExistingImage(tab.id, page, frame.rect, delta[0], delta[1]));
    }
    appStore.getState().select(null);
  };

  const openText = (frame: Frame) => {
    const o = frame.object;
    if (!o || o.kind !== "text") return;
    appStore.getState().openInlineEditor({ tabId: tab.id, page, origin: o.origin!, objectId: o.id, text: o.text!, style: o.style! });
  };

  return (
    <div ref={layer} className={`edit-layer tool-${tool}`} onPointerDown={onLayerDown} onPointerMove={onMove} onPointerUp={onUp}>
      {frames.map((frame, i) => {
        const moving = drag?.frame === frame ? drag : null;
        const d = moving?.mode === "move" ? moving.delta : [0, 0];
        const grow = moving?.mode === "resize" ? moving.delta : [0, 0];
        const [x0, y0, x1, y1] = transform.rectToDisplay([frame.rect[0] + d[0], frame.rect[1] + d[1], frame.rect[2] + d[0] + grow[0], frame.rect[3] + d[1] + grow[1]]);
        const isSelected = selected?.page === page && selected.tabId === tab.id && selected.id === frame.id && selected.rect === frame.rect;
        const hidden = editor?.objectId && editor.objectId === frame.id;
        if (hidden) return null;
        return (
          <div
            key={frame.id ?? `img-${i}`}
            className={`edit-frame ${frame.kind} ${frame.id ? "ours" : "existing"} ${isSelected ? "selected" : ""}`}
            style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
            onPointerDown={onFrameDown(frame, "move")}
            onDoubleClick={() => openText(frame)}
          >
            {isSelected && frame.kind === "image" && (
              <>
                {frame.id && <div className="edit-handle" onPointerDown={onFrameDown(frame, "resize")} />}
                <button className="frame-action" onPointerDown={(e) => e.stopPropagation()} onClick={() => void replaceSelectedImage()}>
                  {t("replaceImage")}
                </button>
              </>
            )}
          </div>
        );
      })}
      {editor && editor.tabId === tab.id && editor.page === page && (
        <InlineTextEditor
          state={editor}
          transform={transform}
          zoom={zoom}
          onChange={(text) => appStore.getState().updateInlineText(text)}
          onCommit={() => void commitInlineEditor()}
          onCancel={() => appStore.getState().closeInlineEditor()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into PageSlot and PageCanvas**

`PageCanvas` props gain `revision: number`; add it to the render effect's dependency list.
`PageSlot`: pass `revision={tab.revision}` to `PageCanvas`; read `const editMode = useApp((s) => s.editMode);`; when `editMode`, don't attach the text-selection pointer handlers and render `<EditLayer tab={tab} page={slot.page} transform={transform} zoom={tab.zoom} />` after the overlay.
Thumbnails (`LeftPanel`) pass `revision={tab.revision}` too.

`app.css`:
```css
.edit-layer { position: absolute; inset: 0; }
.edit-layer.tool-text { cursor: text; }
.edit-frame { position: absolute; border: 1px dashed rgba(194, 65, 12, 0.6); cursor: move; }
.edit-frame.existing { border-color: rgba(37, 99, 235, 0.6); }
.edit-frame.selected { border: 2px solid var(--accent); }
.edit-handle { position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px; background: var(--accent); border-radius: 2px; cursor: nwse-resize; }
.frame-action { position: absolute; top: -30px; left: 0; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); cursor: pointer; white-space: nowrap; }
.inline-editor { position: absolute; min-width: 120px; padding: 0 2px; border: 1px solid var(--accent); background: rgba(255, 255, 255, 0.9); resize: none; overflow: hidden; outline: none; white-space: pre; z-index: 4; }
```

- [ ] **Step 5: Run** `npm test` → PASS; `npx tsc --noEmit` → clean; `npm run build` → PASS.

- [ ] **Step 6: Browser check** (`npm run dev`, built-in browser): open the fixture, toggle Edit, Add text, click, type `ශ්‍රී ලංකාව යාපනය யாழ்ப்பாணம் Jaffna`, Cmd/Ctrl+Enter → text appears on the page correctly shaped; drag it; double-click to edit; Undo/Redo; Add image (PNG), move/resize; select the existing-image case using a fixture with an image; Save (browser downloads). Search finds `யாழ்ப்பாணம்` in the edited page.

- [ ] **Step 7: Commit** `git add src && git commit -m "feat(viewer): edit layer with frames, dragging and inline text editor"`.

---

### Task 13: End-to-end verification and Windows build

**Files:** none new (verification), fixes as needed.

- [ ] **Step 1:** `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npx tsc --noEmit`, `npm run check:pdfkit` → record results.
- [ ] **Step 2:** `npx tauri build --bundles app,dmg`; in the built app on macOS:
  - Add Sinhala, Tamil, English and mixed text boxes (bold/serif/colour/size), move, edit, delete, undo/redo.
  - Add/move/resize/replace/delete images; delete and move an existing image.
  - Save (⌘S) over a copy of a PDF, Save As to a new name, reopen both → edits present; tab `•` behaviour; close/quit prompts.
  - Open the saved file in **Adobe Acrobat** (installed on this Mac) and **Preview**: text renders correctly; search in Acrobat finds the Sinhala and Tamil words exactly.
  - A PDF with edit restrictions → Edit disabled with explanation; a signed PDF → warning.
- [ ] **Step 3:** Push branch, trigger **Build installers** (Windows) via `gh workflow run build.yml -f platform=windows --ref feat/editing` (workflow must exist on `main`, which it does), wait for the artifact.
- [ ] **Step 4:** Final whole-branch review per executing-plans; fixes; then offer PR + merge.
