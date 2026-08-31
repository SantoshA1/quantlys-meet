/**
 * MAYA GUARD — search engines have to be able to find Quantlys Meeting.
 *
 * Run: node lib/crawl.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const home = code("../app/page.tsx");
const sitemap = code("../app/sitemap.ts");
const robots = code("../app/robots.ts");
const example = code("../app/example-prd/page.tsx");
const publicFiles = readdirSync(new URL("../public", import.meta.url));
const indexNow = publicFiles.filter((f) => /^[a-f0-9]{32}\.txt$/.test(f));

ok(/title:\s*"Quantlys Meeting/.test(home),
  "homepage title starts with Quantlys Meeting");
ok(/robots:\s*\{\s*index:\s*true/.test(home),
  "homepage asks to be indexed");
ok(/name:\s*"Quantlys Meeting"/.test(home),
  "schema name is Quantlys Meeting");
ok(/lastModified/.test(sitemap) && /quantlys-meeting.com\/"/.test(sitemap),
  "sitemap lists the homepage with lastModified");
ok(/sitemap:\s*"https:\/\/quantlys-meeting.com\/sitemap.xml"/.test(robots),
  "robots points at the sitemap");
ok(!/Disallow:\s*\//.test(robots) && /allow:\s*"\/"/.test(robots),
  "robots allows the site root");
ok(/Quantlys Meeting/.test(example),
  "example PRD page names Quantlys Meeting");
ok(indexNow.length === 1, "one IndexNow key file at the site root");
if (indexNow[0]) {
  const key = indexNow[0].slice(0, -4);
  const body = read("../public/" + indexNow[0]).trim();
  ok(body === key, "IndexNow key file body matches the filename");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
