import { baseName } from "./sources";

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

const KEY = "leopdf.recent";
const MAX = 10;

export function addRecent(list: RecentFile[], path: string, now = Date.now()): RecentFile[] {
  return [{ path, name: baseName(path), openedAt: now }, ...list.filter((r) => r.path !== path)].slice(0, MAX);
}

export function removeRecent(list: RecentFile[], path: string): RecentFile[] {
  return list.filter((r) => r.path !== path);
}

export function loadRecent(storage: Storage = localStorage): RecentFile[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? (value as RecentFile[]) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: RecentFile[], storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable: recent files are a convenience, ignore.
  }
}
