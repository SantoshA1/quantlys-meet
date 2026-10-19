// node --experimental-strip-types lib/caption-relay.test.mjs
import { feedLevel, newSegment, rmsOf, relayQuery, relayContentType, relayText, SEGMENTER_DEFAULTS, RELAY_MODEL } from "./caption-relay.ts";
import { keytermParams, sanitizeGlossary } from "./keyterms.ts";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} - ${m}`); };

// Drive the segmenter at 50ms steps with a level script: [[ms, rms], ...]
function run(script) {
  let s = newSegment(0), t = 0; const acts = [];
  for (const [ms, rms] of script) {
    for (let e = t + 50; e <= t + ms; e += 50) {
      const r = feedLevel(s, rms, e);
      s = r.state;
      if (r.action !== "none") { acts.push([r.action, e]); s = newSegment(e, s.noise); }
    }
    t += ms;
  }
  return acts;
}

{
  const acts = run([[500, 0.002], [1500, 0.08], [1000, 0.002]]);
  ok(acts.length === 1 && acts[0][0] === "send", "speech then a pause sends one utterance");
  ok(acts[0][1] >= 2000 + SEGMENTER_DEFAULTS.endSilenceMs && acts[0][1] <= 2000 + SEGMENTER_DEFAULTS.endSilenceMs + 50, "…right after the end-of-speech pause");
}
{
  const acts = run([[1000, 0.08], [300, 0.002], [1000, 0.08], [1000, 0.002]]);
  ok(acts.filter((a) => a[0] === "send").length === 1, "a short breath mid-sentence does not cut the sentence");
}
{
  const acts = run([[100, 0.08], [1500, 0.002]]);
  ok(!acts.some((a) => a[0] === "send"), "a cough is not sent");
}
{
  const acts = run([[9000, 0.002]]);
  ok(acts.length >= 2 && acts.every((a) => a[0] === "discard"), "silence is discarded, never sent");
}
{
  const acts = run([[30000, 0.08]]);
  const sends = acts.filter((a) => a[0] === "send");
  ok(sends.length === 2 && sends[0][1] === SEGMENTER_DEFAULTS.maxMs, "a monologue is cut at the max length");
}
{
  // Steady hum above the fixed floor adapts the threshold so it isn't "speech".
  const acts = run([[8000, 0.011], [1500, 0.09], [1000, 0.011]]);
  ok(acts.filter((a) => a[0] === "send").length === 1, "background hum below threshold doesn't hold the line open");
}
ok(Math.abs(rmsOf([1, -1, 1, -1]) - 1) < 1e-9 && rmsOf([128, 128], true) === 0, "rms of floats and bytes");

const q = relayQuery(sanitizeGlossary(["Quill", "CSV export", "<script>"]));
ok(q.get("model") === RELAY_MODEL && q.getAll("keyterm").join("|") === "Quill|CSV export|script", "relay sends sanitised keyterms to nova-3");
ok(!q.has("callback") && !q.has("encoding"), "nothing else from the client reaches the query");
ok(keytermParams(RELAY_MODEL, [], ["Quill"]).some(([k]) => k === "keyterm"), "nova-3 uses keyterm");
ok(relayContentType("audio/webm;codecs=opus") === "audio/webm", "webm/opus accepted");
ok(relayContentType("text/html") === null && relayContentType(null) === null, "non-audio refused");
ok(relayText({ results: { channels: [{ alternatives: [{ transcript: " hi " }] }] } }) === "hi" && relayText({}) === "", "transcript extraction");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
