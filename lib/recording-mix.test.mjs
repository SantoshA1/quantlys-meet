// node --experimental-strip-types lib/recording-mix.test.mjs
import { readFileSync } from "node:fs";
import { diffSources, wantedAudio } from "./recording-mix.ts";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} - ${m}`); };
const pubs = (...list) => ({ audioTrackPublications: new Map(list.map((p, i) => [String(i), p])) });
const pub = (id, extra = {}) => ({ isSubscribed: true, track: { mediaStreamTrack: { id, kind: "audio", readyState: "live", ...extra } } });

let d = diffSources([], ["mic-host", "guest-1"]);
ok(d.add.join() === "mic-host,guest-1" && !d.remove.length, "Record: host mic and guest both join the mix");
d = diffSources(["mic-host", "guest-1"], ["mic-host", "guest-1", "guest-2"]);
ok(d.add.join() === "guest-2" && !d.remove.length, "a guest who joins mid-take is added, nobody re-added");
d = diffSources(["mic-host", "guest-1"], ["mic-host", "guest-1b"]);
ok(d.add.join() === "guest-1b" && d.remove.join() === "guest-1", "a republished mic swaps tracks");
d = diffSources(["mic-host", "guest-1"], ["mic-host"]);
ok(d.remove.join() === "guest-1" && !d.add.length, "a guest who leaves is removed");

const w = wantedAudio([pubs(pub("g1"), pub("g1-screen")), pubs(pub("g2", { readyState: "ended" })), pubs({ isSubscribed: false, track: null })], { id: "me", kind: "audio", readyState: "live" });
ok([...w.keys()].join() === "g1,g1-screen,me", "remote mics + screen audio + my own mic; ended and unsubscribed tracks skipped");
ok(wantedAudio([], null).size === 0, "no tracks, no sources");

// Wiring: the recorder must not mix <audio> elements any more.
const conf = readFileSync(new URL("../app/room/[room]/Conference.tsx", import.meta.url), "utf8");
const build = conf.slice(conf.indexOf("function syncRecAudio("), conf.indexOf("function syncRecStage("));
ok(build.length > 200 && !/createMediaElementSource/.test(build), "buildAudio no longer uses createMediaElementSource");
ok(!/querySelectorAll\("audio"\)/.test(build), "…nor scrapes <audio> elements once at Record");
ok(/createMediaStreamSource/.test(build) && /wantedAudio\(/.test(build), "it mixes the LiveKit MediaStreamTracks");
ok(/RoomEvent\.TrackSubscribed/.test(build) && /setInterval\(/.test(build), "and keeps reconciling while recording (late joiners, republishes)");
ok(/stopRecAudio\(\)/.test(conf.slice(conf.indexOf("vr.onstop"), conf.indexOf("vr.onstop") + 400)), "the mix is torn down when the take stops");

// Spec sessions auto-record once; Save & leave's stop must not start a second take.
const specFx = conf.slice(conf.indexOf("const specAutoRec = useRef(false);"), conf.indexOf("}, [spec, signedIn, recording]);"));
ok(/specAutoRec\.current\) return;/.test(specFx) && /specAutoRec\.current = true/.test(specFx), "spec auto-record is once per visit (no empty second take after Stop / Save & leave)");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
