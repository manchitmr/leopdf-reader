import { expect, test } from "vitest";
import type { EngineApi } from "./engine-api";
import { lazyApi } from "./lazy-api";

test("calls made before the engine has loaded are answered once it loads", async () => {
  let resolve!: (api: EngineApi) => void;
  const api = lazyApi(() => new Promise<EngineApi>((r) => (resolve = r)));
  const pending = api.search("doc", "ශ්රී");
  resolve({ search: async (id: string, q: string) => [{ page: 0, rects: [], id, q }] } as unknown as EngineApi);
  expect(await pending).toEqual([{ page: 0, rects: [], id: "doc", q: "ශ්රී" }]);
});

test("exposes every engine method", async () => {
  const { createEngineApi } = await import("./engine-api");
  const api = lazyApi(() => new Promise<EngineApi>(() => {}));
  expect(Object.keys(api).sort()).toEqual(Object.keys(createEngineApi()).sort());
});
