import { useCallback } from "react";
import { useApp } from "../state/store";
import { translate, type StringKey } from "./strings";

export function useT() {
  const lang = useApp((s) => s.lang);
  return useCallback((key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}
