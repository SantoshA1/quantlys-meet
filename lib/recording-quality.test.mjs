/**
 * MAYA GUARD — the continuous take: 720p, one file, uploaded resumably.
 *
 * Maya asks: "I recorded an hour-long episode. Can I download ONE continuous
 * file at HD 720p — not ten pieces — without blowing the storage budget?"
 *
 * Run: node lib/recording-quality.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  RECORDING_PRESET, videoQualityLabel, acceptVideoMeta, tusMetadata,
  resumableEndpoint, resumableUpload, uploadRefusalText,
  RESUMABLE_CHUNK_BYTES, RESUMABLE_THRESHOLD_BYTES,
} from "./recording-quality.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (rel) => read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

ok(RECORDING_PRESET.width === 1280 && RECORDING_PRESET.height === 720, "take is 1280×720 (HD 720p)");
ok(RECORDING_PRESET.fps === 24, "…at 24fps (pre-#81 match)");
ok(RECORDING_PRESET.videoBitsPerSecond === 2_500_000, "…at 2.5 Mbps for storage savings");
ok(RECORDING_PRESET.label === "720p", "…labeled 720p");

ok(videoQualityLabel(720) === "720p" && videoQualityLabel(1080) === "1080p" && videoQualityLabel(2160) === "4K" && videoQualityLabel(0) === "",
  "quality label from height; nothing when unknown");

const m = acceptVideoMeta({ width: 1280, height: 720, fps: 24, bitrate: 2.5e6, container: "mp4", mime: "video/mp4" });
ok(m && m.height === 720 && m.container === "mp4" && m.continuous === true, "video meta accepted and marked continuous");
ok(acceptVideoMeta({ width: 1280, height: 720, fps: 24, container: "mov" }) === null, "MOV is not a container we make — refused");
ok(acceptVideoMeta({ width: 99999, height: 720, fps: 24, container: "mp4" }) === null, "absurd sizes refused");
ok(acceptVideoMeta(null) === null, "missing meta stays null — no guessed label");

ok(resumableEndpoint("https://x.supabase.co/") === "https://x.supabase.co/storage/v1/upload/resumable",
  "Supabase TUS endpoint");
ok(tusMetadata({ bucketName: "recordings", objectName: "u/r/a.mp4" }) ===
  `bucketName ${Buffer.from("recordings").toString("base64")},objectName ${Buffer.from("u/r/a.mp4").toString("base64")}`,
  "TUS metadata is key base64(value)");
ok(RESUMABLE_CHUNK_BYTES === 6 * 1024 * 1024 && RESUMABLE_THRESHOLD_BYTES <= 50 * 1024 * 1024,
  "6 MB transport chunks (Supabase requirement); resumable kicks in well before a 50 MB cap");
ok(/limit|download it now/i.test(uploadRefusalText(413, "")), "a size refusal says the take is still downloadable");

// Fake TUS server: one object, offsets enforced.
function fakeServer({ failPatchOnce = false, refuseCreate = 0 } = {}) {
  let stored = new Uint8Array(0), length = 0, patches = 0, failed = false;
  const hdr = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
  const f = async (url, init) => {
    if (init.method === "POST") {
      if (refuseCreate) return { ok: false, status: refuseCreate, headers: hdr({}), text: async () => "The object exceeded the maximum allowed size" };
      length = Number(init.headers["Upload-Length"]);
      return { ok: true, status: 201, headers: hdr({ location: "https://x/storage/v1/upload/resumable/abc" }), text: async () => "" };
    }
    if (init.method === "HEAD") return { ok: true, status: 200, headers: hdr({ "upload-offset": String(stored.length) }), text: async () => "" };
    if (init.method === "PATCH") {
      patches++;
      if (failPatchOnce && !failed && patches === 2) { failed = true; throw new Error("network drop"); }
      const off = Number(init.headers["Upload-Offset"]);
      if (off !== stored.length) return { ok: false, status: 409, headers: hdr({}), text: async () => "offset" };
      const buf = new Uint8Array(await init.body.arrayBuffer());
      const next = new Uint8Array(stored.length + buf.length); next.set(stored); next.set(buf, stored.length); stored = next;
      return { ok: true, status: 204, headers: hdr({ "upload-offset": String(stored.length) }), text: async () => "" };
    }
  };
  return { f, get stored() { return stored; }, get length() { return length; }, get patches() { return patches; } };
}

const bytes = new Uint8Array(25).map((_, i) => i);
const blob = new Blob([bytes]);
{
  const s = fakeServer();
  const prog = [];
  const r = await resumableUpload({ endpoint: "https://x/storage/v1/upload/resumable", token: "t", apikey: "k",
    bucket: "recordings", objectName: "u/r/a.mp4", blob, contentType: "video/mp4", chunkBytes: 10,
    fetchImpl: s.f, onProgress: (a) => prog.push(a) });
  ok(r.ok && s.stored.length === 25 && s.stored.every((b, i) => b === i), "uploads every byte, in order, as ONE object");
  ok(s.patches === 3 && prog.join(",") === "10,20,25", "…in transport chunks with progress");
}
{
  const s = fakeServer({ failPatchOnce: true });
  const r = await resumableUpload({ endpoint: "https://x/e", token: "t", apikey: "k", bucket: "b", objectName: "o",
    blob, contentType: "video/mp4", chunkBytes: 10, fetchImpl: s.f });
  ok(r.ok && s.stored.length === 25 && s.stored.every((b, i) => b === i), "a dropped connection resumes from the server offset");
}
{
  const s = fakeServer({ refuseCreate: 413 });
  const r = await resumableUpload({ endpoint: "https://x/e", token: "t", apikey: "k", bucket: "b", objectName: "o",
    blob, contentType: "video/mp4", chunkBytes: 10, fetchImpl: s.f });
  ok(!r.ok && r.status === 413 && /download it now/i.test(r.error), "a project size cap is reported honestly, take kept");
}

const conf = code("../app/room/[room]/Conference.tsx");
ok(/RECORDING_PRESET\.width/.test(conf) && !/canvas\.width = 1920/.test(conf), "room recorder draws the preset canvas (720p), not a hardcoded 1920");
ok(/captureStream\(RECORDING_PRESET\.fps\)/.test(conf), "…captures at the preset fps");
ok(/VideoPresets\.h720\.resolution/.test(conf) && !/VideoPresets\.h1080\.resolution/.test(conf), "cameras capture up to 720p (not 1080)");
ok(/VideoPresets\.h180/.test(conf) && /VideoPresets\.h360/.test(conf), "simulcast layers fit 720p (180/360 under 720 top)");
ok(/syncRecStage|qmr-recstage/.test(conf), "remote tiles are recorded from full-res twins, not thumbnails");
ok(/resumableUpload\(/.test(conf), "large takes upload resumably");
ok(/Download take/.test(conf), "the take is downloadable from the tab even if the cloud refuses it");
ok(!/timeslice|segment\d|part-\d/i.test(conf.match(/async function save\(\)[\s\S]*?\n  }\n/)?.[0] || ""),
  "save() stores one file — no segment/part naming");

const finish = code("../app/api/recording/finish/route.ts");
ok(/acceptVideoMeta\(body\.video\)/.test(finish), "summary keeps what the take actually is");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
