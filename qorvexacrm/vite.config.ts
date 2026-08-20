import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// QORVEXA CRM landing page — a plain static Vite build (no SSR).
// Output: dist/ — served by the CRM Express server at the site root (/).
// The CRM app itself is served at /app (see the CRM's own build).
export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
