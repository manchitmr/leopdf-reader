import { Bold, ImagePlus, Italic, MousePointer2, Save, Strikethrough, Type, Underline } from "lucide-react";
import { useEffect, useState } from "react";
import type { TextStyle } from "../edit/types";
import { useT } from "../i18n/useT";
import { faceOf, findInstalled, installHint, listSystemFonts, type SystemFont } from "../platform/fonts";
import { sameColor, TEXT_COLORS, toHex } from "../state/palette";
import { useApp, type DocTab } from "../state/store";
import { Swatches } from "./Swatches";
import { addImageFromPicker, saveTab } from "./edit-actions";

const fromHex = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const NOTO = { sans: "Noto Sans", serif: "Noto Serif" };
/** Keeps focus in the inline editor when a bar button is clicked. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function EditBar({ tab }: { tab: DocTab }) {
  const t = useT();
  const tool = useApp((s) => s.editTool);
  const editor = useApp((s) => s.inlineEditor);
  const style = useApp((s) => s.inlineEditor?.style ?? s.textStyle);
  const setTool = useApp((s) => s.setEditTool);
  const setStyle = useApp((s) => s.setTextStyle);
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  useEffect(() => void listSystemFonts().then(setFonts), []);

  // Installed fonts that write Sinhala or Tamil, plus the one in use (e.g. Times New Roman matched from the PDF).
  const families = [...new Set(fonts.filter((f) => f.sinhala || f.tamil || f.family === style.face?.family).map((f) => f.family))];
  const setFamily = (value: string) => {
    if (value === "noto-sans" || value === "noto-serif") setStyle({ family: value === "noto-sans" ? "sans" : "serif", face: undefined });
    else setStyle({ face: faceOf(fonts, value, style.bold, !!style.italic) });
  };
  /** Bold/italic switch to that face of an installed family when it has one (else they are synthesised). */
  const toggle = (patch: Partial<TextStyle>) => {
    const next = { ...style, ...patch };
    setStyle(style.face ? { ...patch, face: faceOf(fonts, style.face.family, next.bold, !!next.italic) } : patch);
  };
  const toggleButton = (on: boolean, label: string, icon: React.ReactNode, patch: Partial<TextStyle>) => (
    <button className={`icon-button ${on ? "pressed" : ""}`} aria-label={label} aria-pressed={on} title={label} onMouseDown={keepFocus} onClick={() => toggle(patch)}>
      {icon}
    </button>
  );

  return (
    <div className="editbar" role="toolbar" aria-label={t("editPdf")}>
      <button className={`icon-button ${tool === "select" ? "pressed" : ""}`} aria-label={t("toolSelectObjects")} title={t("toolSelectObjects")} onClick={() => setTool("select")}>
        <MousePointer2 size={18} />
      </button>
      <button className={`icon-button ${tool === "text" ? "pressed" : ""}`} aria-label={t("addText")} title={t("addText")} onClick={() => setTool("text")}>
        <Type size={18} />
      </button>
      <button className="icon-button" aria-label={t("addImage")} title={t("addImage")} onClick={() => void addImageFromPicker(tab.id, tab.currentPage)}>
        <ImagePlus size={18} />
      </button>
      <div className="separator" />
      <select aria-label={t("fontFamily")} title={t("fontFamily")} value={style.face?.family ?? `noto-${style.family}`} onChange={(e) => setFamily(e.target.value)}>
        <optgroup label={t("bundledFonts")}>
          <option value="noto-sans">{NOTO.sans}</option>
          <option value="noto-serif">{NOTO.serif}</option>
        </optgroup>
        {families.length > 0 && (
          <optgroup label={t("installedFonts")}>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <input
        className="size-input"
        type="number"
        min={4}
        max={144}
        step={0.5}
        aria-label={t("fontSize")}
        title={t("fontSize")}
        value={style.size}
        onChange={(e) => {
          const size = Number(e.target.value);
          if (Number.isFinite(size) && size >= 4 && size <= 144) setStyle({ size });
        }}
      />
      {toggleButton(style.bold, t("bold"), <Bold size={18} />, { bold: !style.bold })}
      {toggleButton(!!style.italic, t("italic"), <Italic size={18} />, { italic: !style.italic })}
      {toggleButton(!!style.underline, t("underline"), <Underline size={18} />, { underline: !style.underline })}
      {toggleButton(!!style.strike, t("strikethrough"), <Strikethrough size={18} />, { strike: !style.strike })}
      <div className="text-colors" onMouseDown={keepFocus}>
        <Swatches colors={TEXT_COLORS} value={style.color} onPick={(color) => setStyle({ color })} />
      </div>
      {/* Any other colour: a round swatch over the native picker, filled with the colour once it's chosen. */}
      <label
        className={`swatch custom-color ${TEXT_COLORS.some((c) => sameColor(c, style.color)) ? "" : "pressed"}`}
        style={TEXT_COLORS.some((c) => sameColor(c, style.color)) ? undefined : { background: toHex(style.color) }}
        title={t("textColor")}
      >
        <input type="color" aria-label={t("textColor")} value={toHex(style.color)} onChange={(e) => setStyle({ color: fromHex(e.target.value) })} />
      </label>
      <div className="spacer" />
      {editor?.line ? (
        <PdfFontNote fontName={editor.line.fontName} fonts={fonts} fallback={NOTO[editor.line.style.family]} bold={editor.line.style.bold} />
      ) : (
        tool === "text" && <span className="muted">{t("clickToAddText")}</span>
      )}
      <button className="primary-button" onClick={() => void saveTab(tab.id, { as: false })}>
        <Save size={16} /> {t("save")}
      </button>
    </div>
  );
}

/** Which font the edited line uses in the PDF, and whether this computer has it. */
function PdfFontNote({ fontName, fonts, fallback, bold }: { fontName: string; fonts: SystemFont[]; fallback: string; bold: boolean }) {
  const t = useT();
  const installed = findInstalled(fonts, fontName, bold, false);
  const hint = installHint(fontName);
  const detail = installed ? t("pdfFontUsed") : `${t("pdfFontMissing", { name: fontName, fallback })}${hint ? ` ${t(hint)}` : ""}`;
  return (
    <span className={`pdf-font ${installed ? "ok" : "missing"}`} title={detail}>
      {t("pdfFont", { name: fontName })} — {installed ? "✓" : "⚠"} {installed ? t("pdfFontUsed") : detail}
    </span>
  );
}
