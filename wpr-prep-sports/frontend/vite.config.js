import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site under /wpr-prep-sports/.
// Override at build time with VITE_BASE if needed (e.g. for a custom domain).
const base = process.env.VITE_BASE ?? "/wpr-prep-sports/";

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
