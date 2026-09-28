import { useEffect, useRef } from "react";
import { getEngine } from "../engine/client";
import type { Rect, Rotation } from "../engine/types";
import { renderScale } from "./layout";

interface Props {
  docId: string;
  page: number;
  bounds: Rect;
  zoom: number;
  rotation: Rotation;
  width: number;
  height: number;
  /** Document revision: bumps after edits so the page is drawn again. */
  revision?: number;
}

/** Renders one page into a canvas; stale renders (after zoom/rotate/unmount) are dropped. */
export function PageCanvas({ docId, page, bounds, zoom, rotation, width, height, revision = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const scale = renderScale(bounds, zoom, window.devicePixelRatio || 1);
      const result = await getEngine().render(docId, page, scale, rotation);
      const canvas = ref.current;
      if (cancelled || !canvas) return;
      canvas.width = result.width;
      canvas.height = result.height;
      canvas.getContext("2d")!.putImageData(new ImageData(result.pixels as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0);
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docId, page, bounds, zoom, rotation, revision]);

  return <canvas ref={ref} className="page-canvas" style={{ width, height }} />;
}
