/**
 * Fetch the four JSON resources written by the scraper and assemble them
 * into a single dataset object.
 *
 * In dev: hits files relative to /, which Vite proxies to the data/ folder
 * if symlinked, or to GitHub Pages if VITE_DATA_BASE is set.
 *
 * In prod (GitHub Pages): hits ../data/ relative to the deployed app.
 */
const DATA_BASE = import.meta.env.VITE_DATA_BASE ?? "/wpr-prep-sports/data";

export async function fetchDataset() {
  const [meta, schools, games, standings] = await Promise.all([
    fetchJson(`${DATA_BASE}/meta.json`),
    fetchJson(`${DATA_BASE}/schools.json`),
    fetchJson(`${DATA_BASE}/games.json`),
    fetchJson(`${DATA_BASE}/standings.json`),
  ]);
  return { meta, schools, games, standings };
}

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} — ${url}`);
  return resp.json();
}
