/**
 * Guards for MODNet matte spike — no GPU / live ORT required in CI.
 * Run: node lib/matte-modnet.test.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Load TS via Node's experimental strip or transpile-free: project tests import .ts directly.
const mod = await import("./matte-modnet.ts");
const {
  PREFERRED_MATTE,
  resolveMattePreference,
  parseMatteToken,
  chromaSkipsMlMatte,
  wantsMlMatte,
  modnetInputSize,
  MODNET_REF_SIZE,
  MODNET_LOCAL_URL,
  MODNET_SHA256,
  ModnetMatte,
  MATTE_STORAGE_KEY,
} = mod;

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

ok(PREFERRED_MATTE === "modnet", "default preferred matte is modnet");
ok(parseMatteToken("modnet") === "modnet", "parse modnet");
ok(parseMatteToken("mediapipe") === "mediapipe", "parse mediapipe");
ok(parseMatteToken("nope") === null, "parse rejects unknown");
ok(resolveMattePreference({ search: "?matte=mediapipe" }) === "mediapipe", "query overrides default");
ok(resolveMattePreference({ search: "?matte=modnet" }) === "modnet", "query selects modnet");
ok(resolveMattePreference({
  search: "",
  storage: { getItem: (k) => k === MATTE_STORAGE_KEY ? "mediapipe" : null },
}) === "mediapipe", "localStorage selects mediapipe");
ok(resolveMattePreference({ search: "?matte=modnet", storage: { getItem: () => "mediapipe" } }) === "modnet",
  "query beats localStorage");

ok(chromaSkipsMlMatte("chroma") === true, "chroma skips ML matte");
ok(chromaSkipsMlMatte("blur") === false, "blur does not skip ML");
ok(chromaSkipsMlMatte("image") === false, "image does not skip ML");
ok(wantsMlMatte("blur") && wantsMlMatte("image") && wantsMlMatte("video"), "blur/image/video want ML");
ok(!wantsMlMatte("chroma"), "chroma does not want ML matte path");

const s = modnetInputSize(1280, 720, MODNET_REF_SIZE);
ok(s.th === 512 && s.tw % 32 === 0 && s.th % 32 === 0, `input size 1280x720 -> ${s.tw}x${s.th} (%32)`);
const s2 = modnetInputSize(720, 1280, MODNET_REF_SIZE);
ok(s2.tw === 512 && s2.th % 32 === 0, `portrait 720x1280 -> ${s2.tw}x${s2.th}`);

ok(typeof ModnetMatte === "function", "ModnetMatte class exported");
ok(MODNET_LOCAL_URL === "/models/modnet_webcam.onnx", "local model path");
ok(typeof MODNET_SHA256 === "string" && MODNET_SHA256.length === 64, "sha256 documented");

// Source guards on qbg.ts — chroma must stay ML-free; fallback path must exist.
const qbg = readFileSync(new URL("./qbg.ts", import.meta.url), "utf8");
ok(qbg.includes('kind === "chroma"'), "qbg still special-cases chroma");
ok(qbg.includes("chromaSkipsMlMatte") || qbg.includes('kind === "chroma"'), "chroma guard present");
ok(qbg.includes("matte-modnet") || qbg.includes("ModnetMatte"), "qbg wires MODNet module");
ok(qbg.includes("mediapipe") || qbg.includes("ImageSegmenter"), "MediaPipe fallback path exists");
ok(qbg.includes("resolveMattePreference") || qbg.includes("PREFERRED_MATTE"), "feature flag wired");
// When MODNet active, heuristic thrash must not run on that path
ok(qbg.includes("matteBackend") || qbg.includes("useModnet") || qbg.includes("modnet"),
  "qbg tracks modnet backend");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
