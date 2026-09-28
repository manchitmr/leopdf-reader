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
