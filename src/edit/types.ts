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
