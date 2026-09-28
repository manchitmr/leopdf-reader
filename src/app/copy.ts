import { activeTab, appStore, type AppStore } from "../state/store";

export async function copySelection(
  store: AppStore = appStore,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Promise<boolean> {
  const text = activeTab(store.getState())?.selection?.text;
  if (!text) return false;
  await clipboard.writeText(text);
  return true;
}
