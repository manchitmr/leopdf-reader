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
