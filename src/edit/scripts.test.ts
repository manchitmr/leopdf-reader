import { expect, test } from "vitest";
import { scriptOf, splitScripts } from "./scripts";

test("scriptOf classifies letters and leaves neutrals unassigned", () => {
  expect(scriptOf("ක")).toBe("sinhala");
  expect(scriptOf("யா")).toBe("tamil");
  expect(scriptOf("A")).toBe("latin");
  expect(scriptOf("7")).toBe("latin");
  expect(scriptOf(" ")).toBeNull();
  expect(scriptOf("‍")).toBeNull();
  expect(scriptOf(",")).toBeNull();
});

test("single-script text with ZWJ is one run", () => {
  expect(splitScripts("ශ්‍රී ලංකාව")).toEqual([{ script: "sinhala", text: "ශ්‍රී ලංකාව", start: 0 }]);
});

test("mixed text splits by script; spaces stay with the run before them", () => {
  const text = "Colombo කොළඹ யாழ்ப்பாணம்";
  expect(splitScripts(text)).toEqual([
    { script: "latin", text: "Colombo ", start: 0 },
    { script: "sinhala", text: "කොළඹ ", start: text.indexOf("ක") },
    { script: "tamil", text: "யாழ்ப்பாணம்", start: text.indexOf("யா") },
  ]);
});

test("punctuation a script font lacks moves to a Latin run", () => {
  const hasGlyph = (script: string, ch: string) => script === "latin" || !/[(),!]/.test(ch);
  const text = "ශ්‍රී ලංකා (2026), யாழ்ப்பாணம்!";
  expect(splitScripts(text, hasGlyph)).toEqual([
    { script: "sinhala", text: "ශ්‍රී ලංකා ", start: 0 },
    { script: "latin", text: "(2026), ", start: text.indexOf("(") },
    { script: "tamil", text: "யாழ்ப்பாணம்", start: text.indexOf("யா") },
    { script: "latin", text: "!", start: text.indexOf("!") },
  ]);
});

test("leading neutrals join the first run when its font has them", () => {
  expect(splitScripts("  කොළඹ")).toEqual([{ script: "sinhala", text: "  කොළඹ", start: 0 }]);
  const noParen = (script: string, ch: string) => script === "latin" || ch !== "(";
  expect(splitScripts("(කොළඹ", noParen)).toEqual([
    { script: "latin", text: "(", start: 0 },
    { script: "sinhala", text: "කොළඹ", start: 1 },
  ]);
});

test("text with only neutrals is a Latin run; empty text has no runs", () => {
  expect(splitScripts(" , ")).toEqual([{ script: "latin", text: " , ", start: 0 }]);
  expect(splitScripts("")).toEqual([]);
});
