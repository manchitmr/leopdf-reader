import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createEngineApi } from "./engine-api";

const fixture = new Uint8Array(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));

test("api delegates to the engine", () => {
  const api = createEngineApi();
  expect(api.open("a", fixture).status).toBe("ok");
  const page = api.render("a", 0, 0.25, 0);
  expect(page.width).toBeGreaterThan(0);
  expect(api.search("a", "ලංකාව")).toHaveLength(1);
  api.close("a");
});
