import { Bold, ImagePlus, MousePointer2, Save, Type } from "lucide-react";
import { useT } from "../i18n/useT";
import { useApp, type DocTab } from "../state/store";
import { addImageFromPicker, saveTab } from "./edit-actions";

const toHex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export function EditBar({ tab }: { tab: DocTab }) {
  const t = useT();
  const tool = useApp((s) => s.editTool);
  const style = useApp((s) => s.textStyle);
  const setTool = useApp((s) => s.setEditTool);
  const setStyle = useApp((s) => s.setTextStyle);
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
      <select aria-label={t("fontFamily")} title={t("fontFamily")} value={style.family} onChange={(e) => setStyle({ family: e.target.value as "sans" | "serif" })}>
        <option value="sans">Noto Sans</option>
        <option value="serif">Noto Serif</option>
      </select>
      <input
        className="size-input"
        type="number"
        min={4}
        max={144}
        aria-label={t("fontSize")}
        title={t("fontSize")}
        value={style.size}
        onChange={(e) => {
          const size = Number(e.target.value);
          if (Number.isFinite(size) && size >= 4 && size <= 144) setStyle({ size });
        }}
      />
      <button className={`icon-button ${style.bold ? "pressed" : ""}`} aria-label={t("bold")} aria-pressed={style.bold} title={t("bold")} onClick={() => setStyle({ bold: !style.bold })}>
        <Bold size={18} />
      </button>
      <input type="color" aria-label={t("textColor")} title={t("textColor")} value={toHex(style.color)} onChange={(e) => setStyle({ color: fromHex(e.target.value) })} />
      <div className="spacer" />
      {tool === "text" && <span className="muted">{t("clickToAddText")}</span>}
      <button className="primary-button" onClick={() => void saveTab(tab.id, { as: false })}>
        <Save size={16} /> {t("save")}
      </button>
    </div>
  );
}
