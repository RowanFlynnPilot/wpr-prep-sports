import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// site.js is deliberately pure data (no import.meta.env) precisely so plain
// Node can read it — the weekly digest does the same.
import { SITE, SITE_TITLE } from "./src/config/site.js";

// GitHub Pages serves the site under /wpr-prep-sports/.
// Override at build time with VITE_BASE if needed (e.g. for a custom
// domain or a fork's repo name). `||`, not `??`: CI passes unset repo
// variables through as EMPTY strings, which must mean "use the default",
// not "base is ''".
const base = process.env.VITE_BASE || "/wpr-prep-sports/";

// Strip a leading "/wpr-prep-sports" off whatever `base` is so the path
// inside the data URL matches both dev and prod.
const dataPrefix = `${base.replace(/\/$/, "")}/data/`;

/**
 * Inject the description + Open Graph / Twitter card tags into index.html.
 *
 * Done here rather than hardcoded in index.html so the strings have exactly
 * one home (config/site.js) and a white-label tenant rebrands by editing
 * that file plus regenerating public/og-card.png — no HTML surgery.
 *
 * The widget is a hash-routed SPA on static hosting, so these are
 * necessarily site-level: crawlers can't see per-game routes. Per-game
 * cards exist as PNGs (scripts/generate_og_cards.py) for the publisher to
 * attach to article shares.
 */
function socialTags() {
  const origin = SITE.widgetOrigin.replace(/\/+$/, "");
  const imageUrl = `${origin}/${SITE.shareImage}`;
  const tag = (attrs) => ({ tag: "meta", attrs, injectTo: "head" });
  return {
    name: "wpr-social-tags",
    transformIndexHtml() {
      return [
        tag({ name: "description", content: SITE.shareDescription }),
        tag({ property: "og:type", content: "website" }),
        tag({ property: "og:site_name", content: SITE.orgName }),
        tag({ property: "og:title", content: SITE_TITLE }),
        tag({ property: "og:description", content: SITE.shareDescription }),
        tag({ property: "og:url", content: `${origin}/` }),
        tag({ property: "og:image", content: imageUrl }),
        tag({ property: "og:image:width", content: "1200" }),
        tag({ property: "og:image:height", content: "630" }),
        tag({ property: "og:image:alt", content: `${SITE_TITLE} — ${SITE.orgName}` }),
        tag({ name: "twitter:card", content: "summary_large_image" }),
        tag({ name: "twitter:title", content: SITE_TITLE }),
        tag({ name: "twitter:description", content: SITE.shareDescription }),
        tag({ name: "twitter:image", content: imageUrl }),
      ];
    },
  };
}

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
        // Allow up to four directory levels: flat `<name>.json`, per-sport
        // `<sport>/<name>.json`, split-layout detail files
        // `<sport>/boxscores/<game_id>.json`, and archived seasons
        // `archive/<season>/<sport>/boxscores/<game_id>.json`.
        if (!/^([a-z0-9_-]+\/){0,4}[a-z0-9_-]+\.json$/i.test(filename)) return next();
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
  plugins: [react(), socialTags(), serveRepoData()],
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
