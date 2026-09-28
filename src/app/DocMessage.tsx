import type { ReactNode } from "react";

/** Centered message card shown in place of a page view (loading, errors, password). */
export function DocMessage({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  return (
    <div className="doc-message-wrap">
      <div className={`doc-message ${tone}`} role={tone === "error" ? "alert" : "status"}>
        {children}
      </div>
    </div>
  );
}
