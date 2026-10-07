#!/usr/bin/env node
/**
 * Ping IndexNow (Bing / Yandex / Seznam / compatible engines) for Quantlys Meeting URLs.
 * Key file: public/<key>.txt  (must be served at https://quantlys-meeting.com/<key>.txt)
 *
 * Usage: node scripts/indexnow-ping.mjs
 * Optional: INDEXNOW_URLS="https://..." comma-separated override
 *
 * Keep defaultUrls in sync with app/sitemap.ts. Google does not use IndexNow;
 * resubmit changed URLs in Google Search Console URL Inspection.
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const host = "quantlys-meeting.com";
const keyDir = join(root, "public");

const keyFile = readdirSync(keyDir).find(
  (f) => /^[a-f0-9]{32}\.txt$/i.test(f)
);
if (!keyFile) {
  console.error("No IndexNow key file (32-hex.txt) in public/");
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/i, "");
const keyLocation = `https://${host}/${keyFile}`;

// Must match app/sitemap.ts (plus sitemap.xml itself for engines that accept it).
const defaultUrls = [
  `https://${host}/`,
  `https://${host}/browser-video-meeting-no-download`,
  `https://${host}/open-source-zoom-alternative`,
  `https://${host}/self-hosted-video-conferencing`,
  `https://${host}/podcast-recording-in-browser`,
  `https://${host}/ai-meeting-assistant-prd`,
  `https://${host}/meeting-that-writes-prd`,
  `https://${host}/prd-from-meeting`,
  `https://${host}/open-source-video-meeting`,
  `https://${host}/memory-mode`,
  `https://${host}/notes-vs-prd`,
  `https://${host}/recap-vs-prd`,
  `https://${host}/example-prd`,
  `https://${host}/privacy`,
  `https://${host}/sitemap.xml`,
];

const urls = process.env.INDEXNOW_URLS
  ? process.env.INDEXNOW_URLS.split(",").map((s) => s.trim()).filter(Boolean)
  : defaultUrls;

const body = {
  host,
  key,
  keyLocation,
  urlList: urls,
};

const endpoints = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
  "https://yandex.com/indexnow",
];

console.log(`IndexNow key=${key} urls=${urls.length}`);
for (const endpoint of endpoints) {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    console.log(`${endpoint} → ${res.status} ${text.slice(0, 200)}`);
  } catch (err) {
    console.error(`${endpoint} → error`, err?.message || err);
  }
}

// Google's sitemap ping endpoint is retired (often 404). Kept as informational only.
try {
  const ping = await fetch(
    `https://www.google.com/ping?sitemap=${encodeURIComponent(`https://${host}/sitemap.xml`)}`
  );
  console.log(`Google sitemap ping → ${ping.status} (retired endpoint; use GSC URL Inspection)`);
} catch (err) {
  console.error("Google sitemap ping error", err?.message || err);
}
