/**
 * MAYA GUARD — "I moved my meetings in-house. Did I actually?"
 *
 * Maya here runs a twelve-person firm that handles other people's money. She
 * was told she could run the meeting server herself so nothing leaves the
 * building. She did. She asks:
 *
 *   "Fine — it's my server. So why did pressing Record do nothing for twenty
 *    seconds, and is anybody still sending my clients' words to a company I
 *    have never heard of?"
 *
 * PHASE 0, 2026-08-18 measured both of those. livekit-server 1.9.12 from one
 * binary carried a real two-person meeting end to end (audio energy 1.81,
 * 198 video frames decoded) with no code change. It also hung for 23 seconds
 * on StartEgress before returning 503, because recording is a separate
 * service — and it happily transcribed via Deepgram, and via the browser's
 * speech API (which is Google's), without saying so anywhere.
 *
 * These guards are about the second sentence in every one of those pairs.
 *
 * Run: node lib/hosting.test.mjs
 */
import {
  hostingKind, httpOrigin, realtimeUrl, hostingNote,
  meetingStep, recordingStep, dataLeaving, privacyHeadline, PROBE_MS, whereToSetEnv,
} from "./hosting.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// ── which kind of hosting is this, really ────────────────────────────────
ok(hostingKind("wss://myproject.livekit.cloud") === "cloud",
  "a LiveKit Cloud URL is recognised as somebody else's building");
ok(hostingKind("ws://127.0.0.1:7880") === "self",
  "a server on her own machine is recognised as hers");
ok(hostingKind("wss://meet.acme-internal.co.uk") === "self",
  "…and so is her own domain, because self-hosted is the default reading, not the exception");
ok(hostingKind("") === "none" && hostingKind("   ") === "none",
  "nothing configured is 'none' and not a guess");
ok(hostingKind("not a url at all") === "none",
  "and a malformed value is 'none' rather than an exception thrown at a health page");

// The trap: matching the vendor name anywhere in the string would misread a
// customer's own hostname as the vendor, and tell a self-hoster their media
// leaves the building when it does not.
ok(hostingKind("wss://livekit.cloudy-widgets.internal") === "self",
  "a private host that merely CONTAINS the vendor's name is still hers — the check is on the hostname, not a substring");
ok(hostingKind("wss://livekit.cloud.evil.example") === "self",
  "…and a lookalike domain is not mistaken for the vendor either");

// ── the probe address ────────────────────────────────────────────────────
ok(httpOrigin("ws://127.0.0.1:7880") === "http://127.0.0.1:7880",
  "ws becomes http so the health check can actually knock on the door");
ok(httpOrigin("wss://x.livekit.cloud/rtc?y=1") === "https://x.livekit.cloud",
  "…wss becomes https, and the path is dropped");
ok(httpOrigin("") === "" && httpOrigin("::::") === "",
  "…and garbage yields an empty origin instead of a request to nowhere");

// ── the precedence that must not drift from the token route ──────────────
// If this list ever disagrees with app/api/room/token/route.ts, the health
// page will cheerfully report a server the app is not using.
ok(realtimeUrl({ NEXT_PUBLIC_LIVEKIT_URL: "ws://a", LIVEKIT_URL: "ws://b", LIVEKIT_WS_URL: "ws://c" }) === "ws://a",
  "NEXT_PUBLIC_LIVEKIT_URL wins, exactly as the token route reads it");
ok(realtimeUrl({ LIVEKIT_URL: "ws://b", LIVEKIT_WS_URL: "ws://c" }) === "ws://b",
  "…then LIVEKIT_URL");
ok(realtimeUrl({ LIVEKIT_WS_URL: "ws://c" }) === "ws://c",
  "…then the legacy name, so an older deployment does not go dark");
ok(realtimeUrl({}) === "", "…and nothing set is empty, not undefined");
ok(realtimeUrl({ LIVEKIT_URL: "  ws://b  " }) === "ws://b",
  "a value pasted with spaces around it still works — that is how keys arrive from dashboards");

// ── can anyone join ──────────────────────────────────────────────────────
const noUrl = meetingStep({ url: "" });
ok(!noUrl.ok, "no server configured is not OK");
ok(/LIVEKIT_URL/.test(noUrl.detail) && /yourself/.test(noUrl.detail),
  "…and it names the variable AND says a server she runs herself is an option — most people do not know that");

const noKey = meetingStep({ url: "ws://127.0.0.1:7880", reachable: true });
ok(!noKey.ok && /LIVEKIT_API_KEY/.test(noKey.detail), "a missing key is not OK and is named");
ok(/keys:/.test(noKey.detail) && /you choose them/.test(noKey.detail),
  "…and a self-hoster is told these are values in her own config file, not something to go and request");

const down = meetingStep({ url: "ws://127.0.0.1:7880", key: "k", secret: "s", reachable: false, status: 0 });
ok(!down.ok && /Nobody can join/.test(down.detail),
  "an unreachable server says nobody can join, in those words");
ok(/the app is fine/.test(down.detail),
  "…and says the app is not the problem, which is the sentence that stops an hour of looking in the wrong place");
ok(down.detail.includes(String(PROBE_MS / 1000)),
  "…and says how long it waited, so 'it didn't answer' is a measurement rather than an opinion");

const up = meetingStep({ url: "ws://127.0.0.1:7880", key: "k", secret: "s", reachable: true });
ok(up.ok && /does not leave your infrastructure/.test(up.detail),
  "a healthy self-hosted server tells her the thing she bought it for");
const cloudUp = meetingStep({ url: "wss://p.livekit.cloud", key: "k", secret: "s", reachable: true });
ok(cloudUp.ok && /through their infrastructure/.test(cloudUp.detail),
  "…and on Cloud it says the opposite, rather than saying nothing");

const notProbed = meetingStep({ url: "ws://127.0.0.1:7880", key: "k", secret: "s", reachable: null });
ok(notProbed.ok && /Not checked/.test(notProbed.detail),
  "'we didn't look' is reported as not looking, never as a pass");

// ── the twenty-three second silence ──────────────────────────────────────
const recSelf = recordingStep({ url: "ws://127.0.0.1:7880", egress: "absent" });
ok(!recSelf.ok, "no recorder is not OK");
ok(/livekit-egress/.test(recSelf.detail),
  "…and it names the service she has to run — the single binary does not record and nothing else says so");
ok(/Redis/.test(recSelf.detail),
  "…and warns it needs Redis too, so the second surprise happens now instead of at 6pm");
ok(/twenty seconds/.test(recSelf.detail),
  "…and tells her pressing Record will hang for twenty seconds, which is the symptom she will actually see");
ok(/Everything else about the meeting works/.test(recSelf.detail),
  "…and says the rest of the meeting is fine, because 'recording is missing' should not read as 'it's broken'");

const recCloud = recordingStep({ url: "wss://p.livekit.cloud", egress: "absent" });
ok(!recCloud.ok && !/livekit-egress/.test(recCloud.detail),
  "on Cloud the same failure gets a different explanation — telling a Cloud customer to install egress is nonsense");

ok(recordingStep({ url: "ws://x", egress: "ok" }).ok, "a working recorder is OK");
ok(recordingStep({ url: "", egress: "absent" }).detail.includes("nothing to record"),
  "with no server at all, recording is not reported as its own separate failure");
ok(recordingStep({ url: "ws://x", egress: "unknown" }).ok,
  "not checking recording is not the same as recording being broken");

// ── what still leaves the building ───────────────────────────────────────
const selfEnv = { LIVEKIT_URL: "ws://127.0.0.1:7880" };
const leaks = dataLeaving(selfEnv);
ok(leaks.some((l) => /Google/.test(l)),
  "the browser caption fallback is disclosed as sending audio to Google — the single least-known fact about this app and the one that matters most to someone self-hosting for privacy");
ok(!leaks.some((l) => /LiveKit Cloud/.test(l)),
  "…and a self-hosted deployment is not told its media passes through LiveKit");

const cloudLeaks = dataLeaving({ NEXT_PUBLIC_LIVEKIT_URL: "wss://p.livekit.cloud", DEEPGRAM_API_KEY: "d" });
ok(cloudLeaks.some((l) => /LiveKit Cloud/.test(l)), "on Cloud, the media path IS disclosed");
ok(cloudLeaks.some((l) => /Deepgram/.test(l)), "…and so is the transcriber");
ok(!cloudLeaks.some((l) => /Google/.test(l)),
  "…and once Deepgram is configured the browser fallback is no longer claimed, because it is no longer used");

const full = dataLeaving({
  LIVEKIT_URL: "ws://127.0.0.1:7880", DEEPGRAM_API_KEY: "d",
  OPENROUTER_API_KEY: "o", RESEND_API_KEY: "r",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
});
ok(full.length === 4, "every outside service is counted once, not summarised away");
ok(full.some((l) => /OpenRouter/.test(l)) && full.some((l) => /Resend/.test(l)) && full.some((l) => /Supabase/.test(l)),
  "…and each one is named, because 'third parties may be involved' is not a disclosure");

const localSb = dataLeaving({ LIVEKIT_URL: "ws://127.0.0.1:7880", DEEPGRAM_API_KEY: "d", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" });
ok(!localSb.some((l) => /Supabase/.test(l)),
  "a Supabase she runs on her own machine is not reported as data leaving — otherwise the honest list cries wolf");

// ── the one line at the top ──────────────────────────────────────────────
ok(privacyHeadline([], "self") === "Nothing in this meeting leaves your infrastructure.",
  "a fully in-house deployment gets to hear that plainly");
ok(/one thing still leaves/.test(privacyHeadline(["a"], "self")),
  "one gap is 'one thing', not 'some things'");
ok(/2 things still leave/.test(privacyHeadline(["a", "b"], "self")),
  "…and two is counted");
ok(privacyHeadline([], "cloud") === "",
  "on Cloud with nothing else configured there is no headline to invent");
ok(/outside services/.test(privacyHeadline(["a", "b"], "cloud")),
  "…and on Cloud the framing is about outside services rather than about leaving her building");

// ── advice that names the right building ─────────────────────────────────
// FIELD, PHASE 0: the app told a woman running livekit-server on her own
// hardware to "add it in Vercel → Settings". She has never used Vercel. She
// went looking for a screen that does not exist.
ok(/Vercel/.test(whereToSetEnv({ VERCEL: "1" })),
  "on Vercel the advice still names Vercel, because that is where the box is");
ok(!/Vercel/.test(whereToSetEnv({})),
  "…but a self-hosted install is never sent to a dashboard it does not have");
ok(/\.env|restart/.test(whereToSetEnv({})),
  "…it is told the thing that is actually true of its own deployment");
ok(/pods|Secret/.test(whereToSetEnv({ KUBERNETES_SERVICE_HOST: "10.0.0.1" })),
  "…and a Kubernetes install is told to roll the pods, not to redeploy on someone's PaaS");
ok(whereToSetEnv({}).length > 20 && /restart/.test(whereToSetEnv({ DOCKER_CONTAINER: "1" })),
  "…and every branch ends with the step people forget: the variable does not exist until a restart");

// ── teeth: prove these guards can actually fail ──────────────────────────
// If hostingKind matched the vendor name as a substring, this would be "cloud".
ok(hostingKind("wss://livekit.cloudy-widgets.internal") !== "cloud",
  "TEETH: the substring trap is a real trap — this line is what a naive implementation gets wrong");
// If dataLeaving only reported configured services, the Google fallback — the
// dangerous default — would be invisible precisely when it is in use.
ok(dataLeaving({ LIVEKIT_URL: "ws://127.0.0.1" }).length > 0,
  "TEETH: an env with nothing optional configured still discloses something, because the DEFAULT is the leak");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
