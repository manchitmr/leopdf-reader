import { readFile } from "node:fs/promises";
import type { FontSource } from "./font-registry";
import { fontFile } from "./fonts";

export const nodeFontSource: FontSource = async (key) =>
  new Uint8Array(await readFile(new URL(`../../node_modules/@expo-google-fonts/${fontFile(key)}`, import.meta.url)));
