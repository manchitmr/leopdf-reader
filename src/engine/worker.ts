import { expose } from "comlink";
import { lazyApi } from "./lazy-api";

// Expose before MuPDF finishes loading so no early message is lost (see lazy-api.ts).
expose(lazyApi(() => import("./engine-api").then((m) => m.createEngineApi())));
