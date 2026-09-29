import { Highlighter, MessageSquarePlus, MousePointer2, PenLine, Pencil, Signature, Type, type LucideIcon } from "lucide-react";
import type { StringKey } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { useApp, type Tool } from "../state/store";
import { chooseTool } from "./annot-actions";
import { enterEditMode } from "./edit-actions";

type RailId = Exclude<Tool, "hand"> | "addText" | "editPdf";

const ITEMS: { id: RailId; icon: LucideIcon; label: StringKey }[] = [
  { id: "select", icon: MousePointer2, label: "toolSelectShort" },
  { id: "comment", icon: MessageSquarePlus, label: "toolComment" },
  { id: "markup", icon: Highlighter, label: "toolHighlight" },
  { id: "draw", icon: Pencil, label: "toolDraw" },
  { id: "addText", icon: Type, label: "addText" },
  { id: "sign", icon: Signature, label: "toolSign" },
  { id: "editPdf", icon: PenLine, label: "editPdf" },
];

/** Acrobat-style vertical tool rail. "Add text" and "Edit PDF" enter E1's Edit mode. */
export function ToolRail() {
  const t = useT();
  const tool = useApp((s) => s.tool);
  const editMode = useApp((s) => s.editMode);
  const editTool = useApp((s) => s.editTool);
  const setEditMode = useApp((s) => s.setEditMode);

  const pressed = (id: RailId) =>
    id === "addText" ? editMode && editTool === "text" : id === "editPdf" ? editMode && editTool === "select" : !editMode && tool === id;
  const onClick = (id: RailId) => {
    if (id === "addText" || id === "editPdf") {
      if (pressed(id)) setEditMode(false);
      else void enterEditMode(id === "addText" ? "text" : "select");
    } else void chooseTool(id);
  };

  return (
    <nav className="tool-rail" aria-label={t("tools")}>
      {ITEMS.map(({ id, icon: Icon, label }) => (
        <button key={id} className={`rail-tool ${pressed(id) ? "pressed" : ""}`} aria-pressed={pressed(id)} title={t(label)} onClick={() => onClick(id)}>
          <Icon size={20} aria-hidden />
          <span>{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
