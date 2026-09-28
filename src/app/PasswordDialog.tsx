import { Lock } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/useT";
import type { DocTab } from "../state/store";
import { DocMessage } from "./DocMessage";
import { closeDocument, unlockTab } from "./open-document";

interface Props {
  tab: DocTab;
  onUnlock?: (id: string, password: string) => void;
  onCancel?: (id: string) => void;
}

export function PasswordDialog({ tab, onUnlock = (id, pw) => void unlockTab(id, pw), onCancel = (id) => void closeDocument(id) }: Props) {
  const t = useT();
  const [password, setPassword] = useState("");
  return (
    <DocMessage>
      <form
        className="password-form"
        onSubmit={(e) => {
          e.preventDefault();
          onUnlock(tab.id, password);
          setPassword("");
        }}
      >
        <h2>
          <Lock size={18} /> {t("passwordTitle")}
        </h2>
        <p>{t("passwordPrompt", { name: tab.name })}</p>
        <input type="password" autoFocus aria-label={t("passwordTitle")} value={password} onChange={(e) => setPassword(e.target.value)} />
        {tab.passwordError && <p className="form-error">{t("passwordWrong")}</p>}
        <div className="form-actions">
          <button type="button" onClick={() => onCancel(tab.id)}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary-button">
            {t("unlock")}
          </button>
        </div>
      </form>
    </DocMessage>
  );
}
