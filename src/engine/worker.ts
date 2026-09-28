import { expose } from "comlink";
import { lazyApi } from "./lazy-api";

// Expose before MuPDF/HarfBuzz finish loading so no early message is lost (see lazy-api.ts).
expose(
  lazyApi(async () => {
    const [{ createEngineApi }, { DocumentEngine }, { fetchFontSource }] = await Promise.all([
      import("./engine-api"),
      import("./document-engine"),
      import("../edit/font-urls"),
    ]);
    return createEngineApi(new DocumentEngine({ fontSource: fetchFontSource }));
  }),
);
