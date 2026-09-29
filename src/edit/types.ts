import type { Point, Quad, Rect } from "../engine/types";
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

/** A text line from the original PDF content that E2 can replace. Page space (y down). */
export interface EditableLine {
  rect: Rect;
  /** Baseline start of the first character. */
  origin: Point;
  /** Text in logical Unicode order (visual-order extraction fixed). */
  text: string;
  /** Visible characters, used to check that a replacement removed only this line. */
  chars: number;
  /** Closest bundled-font match for the original style. */
  style: TextStyle;
  /** Right edge of the line's text column. */
  maxRight: number;
  /** Why the line can't be edited yet. */
  locked?: "legacy" | "no-unicode";
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
