/**
 * MAYA GUARD — Google has to be able to find Quantlys Meeting by name.
 *
 * Crawl files already allow the homepage. The homepage title must say
 * "Quantlys Meeting" or a brand search has nothing to match.
 *
 * Run: node lib/crawl.test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const home = code("../app/page.tsx");
const sitemap = code("../app/sitemap.ts");
const robots = code("../app/robots.ts");
const example = code("../app/example-prd/page.tsx");

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
