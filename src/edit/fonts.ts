import type { Script } from "./scripts";

export type Family = "sans" | "serif";
export type Weight = "regular" | "bold";
export type FontKey = `${Script}-${Family}-${Weight}`;

const NAMES: Record<Script, Record<Family, [pkg: string, file: string]>> = {
  latin: { sans: ["noto-sans", "NotoSans"], serif: ["noto-serif", "NotoSerif"] },
  sinhala: { sans: ["noto-sans-sinhala", "NotoSansSinhala"], serif: ["noto-serif-sinhala", "NotoSerifSinhala"] },
  tamil: { sans: ["noto-sans-tamil", "NotoSansTamil"], serif: ["noto-serif-tamil", "NotoSerifTamil"] },
};

export const ALL_FONT_KEYS: FontKey[] = (["latin", "sinhala", "tamil"] as Script[]).flatMap((s) =>
  (["sans", "serif"] as Family[]).flatMap((f) => (["regular", "bold"] as Weight[]).map((w) => `${s}-${f}-${w}` as FontKey)),
);

export function fontKey(script: Script, family: Family, bold: boolean): FontKey {
  return `${script}-${family}-${bold ? "bold" : "regular"}`;
}

/** Path of the TTF inside node_modules/@expo-google-fonts/. */
export function fontFile(key: FontKey): string {
  const [script, family, weight] = key.split("-") as [Script, Family, Weight];
  const [pkg, name] = NAMES[script][family];
  const dir = weight === "bold" ? "700Bold" : "400Regular";
  return `${pkg}/${dir}/${name}_${dir}.ttf`;
}
