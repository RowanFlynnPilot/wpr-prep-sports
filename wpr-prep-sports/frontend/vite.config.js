import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// GitHub Pages serves the site under /wpr-prep-sports/.
// Override at build time with VITE_BASE if needed (e.g. for a custom domain).
const base = process.env.VITE_BASE ?? "/wpr-prep-sports/";

// Strip a leading "/wpr-prep-sports" off whatever `base` is so the path
// inside the data URL matches both dev and prod.
const dataPrefix = `${base.replace(/\/$/, "")}/data/`;

// In prod the deploy workflow copies repo-root /data/ into /frontend/dist/data/
// so the URL `/wpr-prep-sports/data/games.json` resolves naturally. In dev
// we don't have that copy step, so this plugin serves repo-root data/ live.
function serveRepoData() {
  const dataDir = resolve(__dirname, "../data");
  return {
    name: "wpr-serve-repo-data",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith(dataPrefix)) return next();
        const filename = req.url.slice(dataPrefix.length).split("?")[0];
        if (!/^[a-z0-9_-]+\.json$/i.test(filename)) return next();
        const fullPath = resolve(dataDir, filename);
        if (!existsSync(fullPath)) {
          res.statusCode = 404;
          res.end(`Not found: data/${filename}. Run the scraper.`);
          return;
        }
        const body = await readFile(fullPath, "utf-8");
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveRepoData()],
  base,
  // Prevent react-router-dom (and other libs) from pulling in a second
  // copy of React — fixes the "Invalid hook call" warning chain.
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
