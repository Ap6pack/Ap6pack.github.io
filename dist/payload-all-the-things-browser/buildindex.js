#!/usr/bin/env node
// build-index.js -- generates search-index.json for full-text payload search.
//
// Run locally (requires Node 18+ for built-in fetch):
//   node build-index.js
//
// Writes search-index.json next to this script. Drop that file in the same
// folder as index.html to enable full-text search; without it the page
// silently falls back to filename-only search.

const fs = require("fs");
const path = require("path");

const OWNER = "swisskyrepo";
const REPO = "PayloadsAllTheThings";
const BRANCH = "master";
const TREE_API = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/`;
const FILE_PATTERN = /\.(md|txt|py|fuzz|yaml|yml)$/i;
const CONCURRENCY = 8;

function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function cleanBody(body) {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // drop images, not searchable text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  console.log("Fetching file tree...");
  const { tree } = await fetchJson(TREE_API);
  const files = tree.filter((n) => n.type === "blob" && FILE_PATTERN.test(n.path));
  console.log(`Found ${files.length} indexable files. Fetching contents...`);

  let done = 0;
  const entries = await pool(files, CONCURRENCY, async (file) => {
    const url = RAW_BASE + file.path.split("/").map(encodeURIComponent).join("/");
    try {
      const raw = await fetchText(url);
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${files.length}`);
      return {
        path: file.path,
        title: firstHeading(raw) || file.path.split("/").pop(),
        body: cleanBody(raw)
      };
    } catch (err) {
      console.warn(`  skipping ${file.path}: ${err.message}`);
      return null;
    }
  });

  const index = entries.filter(Boolean);
  const outPath = path.join(__dirname, "search-index.json");
  fs.writeFileSync(outPath, JSON.stringify(index));
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`Wrote ${index.length} entries to ${outPath} (${sizeKb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});