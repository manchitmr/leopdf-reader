import { useT } from "../i18n/useT";
import { getTab, useApp } from "../state/store";
import { resolveDialog } from "./edit-actions";

export function ConfirmDialog() {
  const t = useT();
  const dialog = useApp((s) => s.dialog);
  const tabs = useApp((s) => s.tabs);
  if (!dialog) return null;
  if (dialog.kind === "author" || dialog.kind === "signature") return null;
  let title = t("unsavedTitle");
  let message: string;
  let primary = t("save");
  let showDiscard = true;
  if (dialog.kind === "signed") {
    title = t("editPdf");
    message = t("signedWarning");
    primary = t("continueAction");
    showDiscard = false;
  } else if (dialog.action === "quit" && dialog.tabIds.length > 1) {
    message = t("unsavedQuit", { count: dialog.tabIds.length });
  } else {
    message = t("unsavedPrompt", { name: getTab({ tabs } as never, dialog.tabIds[0])?.name ?? "" });
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="doc-message">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="form-actions">
          <button onClick={() => void resolveDialog("cancel")}>{t("cancel")}</button>
          {showDiscard && <button onClick={() => void resolveDialog("discard")}>{t("dontSave")}</button>}
          <button className="primary-button" onClick={() => void resolveDialog("save")}>
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}
