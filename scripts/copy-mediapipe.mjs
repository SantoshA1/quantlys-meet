// Copies the MediaPipe tasks-vision WASM runtime from node_modules into
// public/mediapipe/wasm so the background-blur fallback loads same-origin
// (no 404 probe, no jsDelivr dependency, CSP-friendly). Runs before build.
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/@mediapipe/tasks-vision/wasm";
const dst = "public/mediapipe/wasm";
if (!existsSync(src)) { console.warn("[copy-mediapipe] tasks-vision not installed; skipping"); process.exit(0); }
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("[copy-mediapipe] copied", src, "->", dst);
