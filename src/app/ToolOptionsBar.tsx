import { ArrowUpRight, Circle, Highlighter, Minus, Pencil, Plus, Square, Strikethrough, Underline, X, type LucideIcon } from "lucide-react";
import type { StringKey } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { DRAW_COLORS, DRAW_WIDTHS, MARKUP_COLORS } from "../state/palette";
import { appStore, useApp, type DrawShape, type MarkupKind } from "../state/store";
import { Swatches } from "./Swatches";

const MARKUPS: { kind: MarkupKind; icon: LucideIcon; label: StringKey }[] = [
  { kind: "highlight", icon: Highlighter, label: "markupHighlight" },
  { kind: "underline", icon: Underline, label: "markupUnderline" },
  { kind: "strikeout", icon: Strikethrough, label: "markupStrikeout" },
];
const SHAPES: { shape: DrawShape; icon: LucideIcon; label: StringKey }[] = [
  { shape: "pen", icon: Pencil, label: "drawPen" },
  { shape: "line", icon: Minus, label: "drawLine" },
  { shape: "arrow", icon: ArrowUpRight, label: "drawArrow" },
  { shape: "rect", icon: Square, label: "drawRect" },
  { shape: "oval", icon: Circle, label: "drawOval" },
];

function ToggleButton({ on, label, icon: Icon, onClick }: { on: boolean; label: string; icon: LucideIcon; onClick(): void }) {
  return (
    <button className={`icon-button ${on ? "pressed" : ""}`} aria-label={label} aria-pressed={on} title={label} onClick={onClick}>
      <Icon size={18} />
    </button>
  );
}

/** Options for the active rail tool (Highlight, Draw, Sign), shown where E1's Edit bar goes. */
export function ToolOptionsBar() {
  const t = useT();
  const tool = useApp((s) => s.tool);
  const markup = useApp((s) => s.markupStyle);
  const draw = useApp((s) => s.drawStyle);
  const signatures = useApp((s) => s.signatures);
  const signatureId = useApp((s) => s.signatureId);
  const s = appStore.getState();

  if (tool === "markup")
    return (
      <div className="editbar tool-options" role="toolbar" aria-label={t("toolHighlight")}>
        {MARKUPS.map((m) => (
          <ToggleButton key={m.kind} on={markup.kind === m.kind} label={t(m.label)} icon={m.icon} onClick={() => s.setMarkupStyle({ kind: m.kind })} />
        ))}
        <div className="separator" />
        <Swatches colors={MARKUP_COLORS} value={markup.colors[markup.kind]} onPick={(color) => s.setMarkupStyle({ color })} />
      </div>
    );

  if (tool === "draw")
    return (
      <div className="editbar tool-options" role="toolbar" aria-label={t("toolDraw")}>
        {SHAPES.map((d) => (
          <ToggleButton key={d.shape} on={draw.shape === d.shape} label={t(d.label)} icon={d.icon} onClick={() => s.setDrawStyle({ shape: d.shape })} />
        ))}
        <div className="separator" />
        <Swatches colors={DRAW_COLORS} value={draw.color} onPick={(color) => s.setDrawStyle({ color })} />
        <select aria-label={t("thickness")} title={t("thickness")} value={draw.width} onChange={(e) => s.setDrawStyle({ width: Number(e.target.value) })}>
          {DRAW_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w} pt
            </option>
          ))}
        </select>
      </div>
    );

  if (tool === "sign")
    return (
      <div className="editbar tool-options" role="toolbar" aria-label={t("toolSign")}>
        {signatures.map((sig) => (
          <span key={sig.id} className={`signature-chip ${sig.id === signatureId ? "pressed" : ""}`}>
            <button className="signature-pick" aria-label={t("toolSign")} aria-pressed={sig.id === signatureId} onClick={() => s.setSignatureId(sig.id)}>
              <img src={sig.png} alt="" />
            </button>
            <button className="icon-button small" aria-label={t("deleteSignature")} title={t("deleteSignature")} onClick={() => s.removeSignature(sig.id)}>
              <X size={12} />
            </button>
          </span>
        ))}
        <button className="primary-button" onClick={() => s.setDialog({ kind: "signature" })}>
          <Plus size={16} /> {t("addSignature")}
        </button>
        <div className="spacer" />
        <span className="muted">{t(signatures.length ? "pickSignature" : "signatureHint")}</span>
      </div>
    );

  return null;
}
