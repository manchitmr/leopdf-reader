export interface SavedSignature {
  id: string;
  /** PNG as a data URL. */
  png: string;
  width: number;
  height: number;
}

const AUTHOR_KEY = "leopdf.author";
const SIGNATURES_KEY = "leopdf.signatures";
export const MAX_SIGNATURES = 5;

/** null = never asked; "" = the user skipped giving a name. */
export function loadAuthor(storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(AUTHOR_KEY);
  } catch {
    return null;
  }
}

export function saveAuthor(name: string, storage: Storage = localStorage): void {
  try {
    storage.setItem(AUTHOR_KEY, name);
  } catch {
    // Storage unavailable: the name lasts for this session.
  }
}

const isSignature = (v: unknown): v is SavedSignature =>
  typeof v === "object" && v !== null && typeof (v as SavedSignature).id === "string" && typeof (v as SavedSignature).png === "string" &&
  typeof (v as SavedSignature).width === "number" && typeof (v as SavedSignature).height === "number";

export function loadSignatures(storage: Storage = localStorage): SavedSignature[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(SIGNATURES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isSignature) : [];
  } catch {
    return [];
  }
}

/** Returns false when the list could not be stored (full or unavailable storage). */
export function saveSignatures(list: SavedSignature[], storage: Storage = localStorage): boolean {
  try {
    storage.setItem(SIGNATURES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function withSignature(list: SavedSignature[], sig: SavedSignature): { list: SavedSignature[]; dropped: boolean } {
  const next = [sig, ...list.filter((s) => s.id !== sig.id)];
  return { list: next.slice(0, MAX_SIGNATURES), dropped: next.length > MAX_SIGNATURES };
}
