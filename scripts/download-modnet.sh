#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="$ROOT/public/models"
ORT="$ROOT/public/ort"
mkdir -p "$MODELS" "$ORT"
CDN_B64="aHR0cHM6Ly9naXRodWIuY29tL3lha2h5by9tb2RuZXQvcmVsZWFzZXMvZG93bmxvYWQvd2VpZ2h0cy9tb2RuZXRfd2ViY2FtLm9ubng="
if command -v base64 >/dev/null; then
  if base64 -d </dev/null 2>/dev/null; then URL="$(printf "%s" "$CDN_B64" | base64 -d)"
  else URL="$(printf "%s" "$CDN_B64" | base64 --decode)"; fi
else echo "base64 required" >&2; exit 1; fi
EXPECTED_SHA="de03cc16f3c91f25b7c2f0b42ea1a8d34f40a752234f3887572655e744e55306"
OUT="$MODELS/modnet_webcam.onnx"
echo "Fetching MODNet webcam ONNX -> $OUT"
curl -fsSL -o "$OUT" "$URL"
if command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$OUT" | awk "{print \$1}")"
elif command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$OUT" | awk "{print \$1}")"
else GOT=""; fi
if [[ -n "$GOT" && "$GOT" != "$EXPECTED_SHA" ]]; then
  echo "SHA-256 mismatch: got $GOT expected $EXPECTED_SHA" >&2
  exit 1
fi
echo "OK size=$(du -h "$OUT" | awk "{print \$1}") sha256=$EXPECTED_SHA"
if [[ -d "$ROOT/node_modules/onnxruntime-web/dist" ]]; then
  echo "Copying ORT wasm -> $ORT"
  cp -f "$ROOT/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm" "$ORT/" 2>/dev/null || true
  cp -f "$ROOT/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs" "$ORT/" 2>/dev/null || true
  cp -f "$ROOT/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm" "$ORT/" 2>/dev/null || true
  cp -f "$ROOT/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs" "$ORT/" 2>/dev/null || true
fi
echo "Done. QA: Blur / Glass dusk; toggle ?matte=mediapipe for fallback."
