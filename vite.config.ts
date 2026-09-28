import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "esnext" },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["mupdf", "harfbuzzjs"] },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
