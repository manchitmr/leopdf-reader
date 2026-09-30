import { useEffect, useRef, useState } from "react";
import { previewFamily } from "../platform/fonts";
import type { InlineEditorState } from "../state/store";
import type { PageTransform } from "./geometry";

export const FAMILIES = {
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
  // Replacing an original line: cover all of it (plus room for the Noto font being a little wider).
  const cover = state.line ? transform.rectToDisplay(state.line.rect) : null;

  useEffect(() => ref.current?.focus(), []);

  const [faceFamily, setFaceFamily] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFaceFamily(null);
    if (style.face) void previewFamily(style.face).then((f) => !cancelled && setFaceFamily(f));
    return () => {
      cancelled = true;
    };
  }, [style.face]);
  // A bold/italic face file already looks bold/italic; only ask the browser to fake what the face lacks.
  const weight = style.bold && !style.face?.bold ? 700 : 400;
  const slant = style.italic && !style.face?.italic ? "italic" : "normal";
  const decoration = [style.underline && "underline", style.strike && "line-through"].filter(Boolean).join(" ") || "none";

  return (
    <textarea
      ref={ref}
      className="inline-editor"
      value={state.text}
      rows={lines}
      spellCheck={false}
      style={{
        left: x,
        ...(cover ? { minWidth: (cover[2] - cover[0]) * 1.15 + 8 } : {}),
        top: y - fontSize * 1.05,
        fontSize,
        lineHeight: 1.4,
        fontFamily: faceFamily ? `${faceFamily}, ${FAMILIES[style.family]}` : FAMILIES[style.family],
        fontWeight: style.face ? weight : style.bold ? 700 : 400,
        fontStyle: slant,
        textDecoration: decoration,
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
      // Using the edit bar (font, size, bold …) keeps the editor open; clicking anywhere else applies it.
      onBlur={(e) => {
        if (!(e.relatedTarget as Element | null)?.closest(".editbar")) onCommit();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
