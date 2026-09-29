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
