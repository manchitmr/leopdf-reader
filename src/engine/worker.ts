import { expose } from "comlink";
import { createEngineApi } from "./engine-api";

expose(createEngineApi());
