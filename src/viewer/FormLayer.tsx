import { useEffect, useState } from "react";
import { runEdit } from "../app/edit-actions";
import { getEngine } from "../engine/client";
import type { FormField } from "../edit/types";
import { useApp, type DocTab } from "../state/store";
import type { PageTransform } from "./geometry";
import { FAMILIES } from "./InlineTextEditor";

const stop = (e: React.PointerEvent) => e.stopPropagation();

/**
 * Fillable form fields on one page (outside Edit mode). The filled values are drawn by the PDF itself; these
 * controls sit on top, show their text only while focused, and write each change back as one undoable edit.
 */
export function FormLayer({ tab, page, transform }: { tab: DocTab; page: number; transform: PageTransform }) {
  const tool = useApp((s) => s.tool);
  const [fields, setFields] = useState<FormField[]>([]);
  const fillable = !!tab.info?.fillable;

  useEffect(() => {
    let cancelled = false;
    if (fillable) void getEngine().listFields(tab.id, page).then((f: FormField[]) => !cancelled && setFields(f));
    return () => {
      cancelled = true;
    };
  }, [tab.id, page, tab.revision, fillable]);

  const editable = fields.filter((f) => !f.readOnly && f.kind !== "button" && f.kind !== "signature");
  if (!editable.length) return null;
  return (
    <div className={`form-layer ${tool === "select" ? "active" : ""}`}>
      {editable.map((f) => {
        const [x0, y0, x1, y1] = transform.rectToDisplay(f.rect);
        const box = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
        return (
          <div key={`${f.id}:${f.value}`} className={`form-field ${f.kind}`} style={box} title={f.label || f.name} onPointerDown={stop}>
            <FieldControl tab={tab} field={f} height={y1 - y0} />
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({ tab, field, height }: { tab: DocTab; field: FormField; height: number }) {
  const [text, setText] = useState(field.value);
  const engine = getEngine();
  const label = field.label || field.name;

  if (field.kind === "checkbox" || field.kind === "radio") {
    return (
      <button
        className="field-toggle"
        role={field.kind}
        aria-label={label}
        aria-checked={!!field.checked}
        onClick={() => void runEdit(tab.id, () => engine.setFieldChecked(tab.id, field.page, field.id, field.kind === "radio" || !field.checked))}
      />
    );
  }
  if (field.kind === "choice") {
    // Invisible select over the field: the PDF shows the chosen value, the browser shows the list.
    return (
      <select aria-label={label} value={field.value} onChange={(e) => void runEdit(tab.id, () => engine.setFieldChoice(tab.id, field.page, field.id, e.target.value))}>
        {!field.options?.includes(field.value) && <option value={field.value} />}
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  const commit = () => {
    if (text !== field.value) void runEdit(tab.id, () => engine.fillText(tab.id, field.page, field.id, text));
  };
  const props = {
    "aria-label": label,
    value: text,
    spellCheck: false,
    maxLength: field.maxLen > 0 ? field.maxLen : undefined,
    style: { fontFamily: FAMILIES.sans, fontSize: field.multiline ? Math.min(16, height / 3) : Math.max(8, height * 0.6) },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") setText(field.value);
      if (e.key === "Enter" && !field.multiline) (e.target as HTMLElement).blur();
    },
  };
  return field.multiline ? <textarea {...props} /> : <input type="text" {...props} />;
}
