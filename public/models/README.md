# MODNet webcam weights

- **Production ships** `modnet_webcam.onnx` (~25MB, Apache-2.0) via force-add; `public/models/*.onnx` stays gitignored for other weights.
- License: Apache-2.0 (ZHKKKe upstream; yakhyo ONNX export)
- SHA-256: de03cc16f3c91f25b7c2f0b42ea1a8d34f40a752234f3887572655e744e55306
- Local fetch (optional): `bash scripts/download-modnet.sh`
- Runtime: prefer same-origin `/models/modnet_webcam.onnx`; ORT wasm uses `/ort/` if present else jsDelivr `onnxruntime-web@1.20.1`.
