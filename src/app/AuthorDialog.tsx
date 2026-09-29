import { useState } from "react";
import { useT } from "../i18n/useT";
import { useApp } from "../state/store";
import { resolveAuthorDialog } from "./annot-actions";

/** Asked once, the first time an annotation tool is picked. */
export function AuthorDialog() {
  const t = useT();
  const dialog = useApp((s) => s.dialog);
  const [name, setName] = useState("");
  if (dialog?.kind !== "author") return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("authorTitle")}>
      <form
        className="doc-message password-form"
        onSubmit={(e) => {
          e.preventDefault();
          void resolveAuthorDialog(name);
        }}
      >
        <h2>{t("authorTitle")}</h2>
        <p>{t("authorPrompt")}</p>
        <input autoFocus aria-label={t("yourName")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="form-actions">
          <button type="button" onClick={() => void resolveAuthorDialog("")}>
            {t("skip")}
          </button>
          <button type="submit" className="primary-button">
            {t("ok")}
          </button>
        </div>
      </form>
    </div>
  );
}
