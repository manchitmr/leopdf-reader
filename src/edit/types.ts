import type { Point, Quad, Rect } from "../engine/types";
import type { Family } from "./fonts";

/** A font installed on this computer (see src-tauri/src/fonts.rs). */
export interface SystemFace {
  path: string;
  /** Face index inside a .ttc collection. */
  index: number;
  family: string;
  postscript: string;
  bold: boolean;
  italic: boolean;
}

export interface TextStyle {
  /** Bundled Noto family, used for everything `face` doesn't cover. */
  family: Family;
  bold: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Installed font to write with (scripts it lacks fall back to Noto). */
  face?: SystemFace;
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

/** A text line from the original PDF content that E2 can replace. Page space (y down). */
export interface EditableLine {
  rect: Rect;
  /** Baseline start of the first character. */
  origin: Point;
  /** Text in logical Unicode order (visual-order extraction fixed). */
  text: string;
  /** Visible characters, used to check that a replacement removed only this line. */
  chars: number;
  /** Closest bundled-font match for the original style (size fitted to the Noto font). */
  style: TextStyle;
  /** The PDF's font name without its subset prefix, e.g. "IskoolaPota-Bold". */
  fontName: string;
  /** The original font size, for when the same font is installed. */
  fontSize: number;
  /** Right edge of the line's text column. */
  maxRight: number;
  /** Why the line can't be edited yet. */
  locked?: "legacy" | "no-unicode";
}

/** A form field (AcroForm widget). Geometry is page space. */
export interface FormField {
  /** PDF object number of the widget — stable across undo/redo. */
  id: number;
  page: number;
  kind: "text" | "checkbox" | "radio" | "choice" | "button" | "signature";
  name: string;
  /** Tooltip / alternate name (/TU), empty if none. */
  label: string;
  rect: Rect;
  value: string;
  readOnly: boolean;
  multiline: boolean;
  /** Maximum characters for text fields; 0 = no limit. */
  maxLen: number;
  options?: string[];
  checked?: boolean;
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
  /** Page indexes to select after a page operation (e.g. where moved or inserted pages now are). */
  pages?: number[];
  /** New page list after pages were added, removed, reordered, turned or cropped (also after undo/redo). */
  info?: import("../engine/types").DocInfo;
  /** The line shares its area with other text (e.g. big background letters); nothing was changed. */
  refused?: "overlap";
  /** The replaced line now runs past its text column (no reflow until E3). */
  overflow?: boolean;
  /** The edit changed nothing (e.g. a highlight dragged over no text). */
  empty?: boolean;
}

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
  /** Created by LeoPDF (colour and size can change); others keep their own appearance. */
  ours: boolean;
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
