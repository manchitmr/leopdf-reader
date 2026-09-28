import { expect, test } from "vitest";
import { FontRegistry } from "./font-registry";
import { ALL_FONT_KEYS, fontFile, fontKey } from "./fonts";
import { nodeFontSource } from "./node-font-source";

test("font keys and files cover 3 scripts × 2 families × 2 weights", () => {
  expect(ALL_FONT_KEYS).toHaveLength(12);
  expect(fontKey("sinhala", "serif", true)).toBe("sinhala-serif-bold");
  expect(fontFile("sinhala-serif-bold")).toBe("noto-serif-sinhala/700Bold/NotoSerifSinhala_700Bold.ttf");
  expect(fontFile("latin-sans-regular")).toBe("noto-sans/400Regular/NotoSans_400Regular.ttf");
});

test("every bundled font loads", async () => {
  const registry = new FontRegistry(nodeFontSource);
  for (const key of ALL_FONT_KEYS) {
    const font = await registry.get(key);
    expect(font.upem, key).toBeGreaterThan(0);
  }
});

test("a loaded font knows its characters and advances, and is cached", async () => {
  const registry = new FontRegistry(nodeFontSource);
  const si = await registry.get("sinhala-sans-regular");
  expect(si.hasChar("ක")).toBe(true);
  expect(si.hasChar("யா")).toBe(false);
  const gid = si.mu.encodeCharacter("ක".codePointAt(0)!);
  expect(si.defaultAdvance(gid)).toBeGreaterThan(0);
  expect(await registry.get("sinhala-sans-regular")).toBe(si);
});

test("a failing source is not cached", async () => {
  let calls = 0;
  const registry = new FontRegistry(async (key) => {
    calls++;
    if (calls === 1) throw new Error("network");
    return nodeFontSource(key);
  });
  await expect(registry.get("latin-sans-regular")).rejects.toThrow("network");
  expect((await registry.get("latin-sans-regular")).upem).toBeGreaterThan(0);
});
