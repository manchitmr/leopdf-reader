export type Rect = [number, number, number, number];
export type Quad = [number, number, number, number, number, number, number, number];
export type Point = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface PageInfo {
  bounds: Rect;
  label: string;
}

export interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

export interface DocInfo {
  pageCount: number;
  pages: PageInfo[];
  outline: OutlineNode[];
  title: string | null;
  repaired: boolean;
  /** False for non-PDF documents and PDFs whose permissions forbid editing. */
  editable: boolean;
  /** The PDF contains digital signatures (editing invalidates them). */
  signed: boolean;
}

export type OpenResult =
  | { status: "ok"; info: DocInfo }
  | { status: "needs-password" }
  | { status: "wrong-password" }
  | { status: "error"; reason: "corrupt" };

export interface RenderedPage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface SearchHit {
  page: number;
  rects: Rect[];
}

export interface Selection {
  rects: Rect[];
  text: string;
}

export type Matrix = [number, number, number, number, number, number];
