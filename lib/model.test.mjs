/**
 * MAYA GUARD — which model writes the notes.
 *
 * Maya asks: "The setup page says my key is accepted. So why are the notes
 * still rubbish?"
 *
 * FIELD 2026-08-18, found by testing the live site the moment he added a
 * working OPENROUTER_API_KEY. The check went green — "OpenRouter accepted your
 * key" — and every model-backed feature was still dead:
 *
 *   {"error":{"message":"No endpoints found for anthropic/claude-3.5-sonnet."}}
 *
 * The id was hardcoded as the default in four routes. The vendor retired it,
 * and a line written months earlier stopped working with a green tick beside
 * it — because "can I reach the provider" and "does the thing I'm asking for
 * exist" are different questions and only the first was ever asked.
 *
 * Run: node lib/model.test.mjs
 */
import { pickModel, idsFrom, PREFERRED, PREFERRED_OPENAI, MODELS_URL } from "./model.ts";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  -", n); } else { fail++; console.error("  FAIL -", n); } };

// What OpenRouter actually offered on the day this was written, minus the one
// the app had hardcoded — which is the whole point.
const LIVE = [
  "anthropic/claude-3-haiku", "anthropic/claude-haiku-4.5", "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-4", "anthropic/claude-sonnet-4.5", "anthropic/claude-sonnet-5",
  "openai/gpt-4o-mini", "google/gemini-flash-1.5",
];

// ── the failure that started this ────────────────────────────────────────
ok(!LIVE.includes("anthropic/claude-3.5-sonnet"),
  "the model the app used to hardcode is genuinely gone from the provider — this is not a hypothetical");
ok(LIVE.includes(pickModel(LIVE).id),
  "with a real listing, the chosen model is one the provider actually has");
ok(pickModel(LIVE).id === "anthropic/claude-sonnet-4.5",
  "…and it is the first PREFERRED entry that exists, so the ranking is the product decision and the resolver is only mechanics");

// The point of the whole file: retiring the top choice costs one rung, not
// the feature.
const minusTop = LIVE.filter((m) => m !== "anthropic/claude-sonnet-4.5");
ok(pickModel(minusTop).id === "anthropic/claude-sonnet-4",
  "retire the first choice and it falls to the second — a vendor deprecation costs a rung, never the feature");
const onlyCheap = ["openai/gpt-4o-mini"];
ok(pickModel(onlyCheap).id === "openai/gpt-4o-mini",
  "…and it keeps falling all the way down rather than giving up");

// ── the operator's override ──────────────────────────────────────────────
const set = pickModel(LIVE, "anthropic/claude-sonnet-5");
ok(set.id === "anthropic/claude-sonnet-5" && set.exact,
  "NOTES_MODEL wins when the model exists — that is the entire point of an override");

const typo = pickModel(LIVE, "anthropic/claude-sonnet-4.5-turbo-ultra");
ok(typo.id === "anthropic/claude-sonnet-4.5" && !typo.exact,
  "a NOTES_MODEL nobody offers does not take the app down — it falls through to a working one");
ok(/doesn't offer/.test(typo.why) && /Check the name/.test(typo.why),
  "…and SAYS it ignored the setting and why. Silently ignoring somebody's explicit configuration is its own kind of lie");
ok(pickModel(LIVE, "  ").id === "anthropic/claude-sonnet-4.5",
  "an empty NOTES_MODEL is not a model called empty string");

// ── when the provider won't say ──────────────────────────────────────────
const blind = pickModel([], undefined);
ok(blind.id === PREFERRED[0] && !blind.exact,
  "an unreachable model list means we TRY the first preference rather than refusing — the call itself is a better test than a secondary endpoint being up");
ok(/Couldn't list models/.test(blind.why), "…and says that is what happened");
ok(pickModel([], "my/model").id === "my/model",
  "…and an explicit NOTES_MODEL is still honoured when we cannot check it, because the operator knows something we don't");

// ── a provider we have never heard of ────────────────────────────────────
const exotic = pickModel(["zeta/whisperwind-9", "alpha/beta-1"]);
ok(exotic.id === "alpha/beta-1",
  "a provider offering nothing on our list gets something rather than nothing — 400 models and none recognised is a list that has aged, not an outage");
ok(/Set NOTES_MODEL/.test(exotic.why), "…and points at the lever that fixes it properly");

// ── reading a provider's listing ─────────────────────────────────────────
ok(idsFrom({ data: [{ id: "a" }, { id: "b" }] }).join(",") === "a,b", "the standard {data:[{id}]} shape is read");
ok(idsFrom({ models: ["x", "y"] }).join(",") === "x,y", "so is a bare list under `models`");
ok(idsFrom(["p", "q"]).join(",") === "p,q", "so is a plain array");
ok(idsFrom(null).length === 0 && idsFrom({}).length === 0 && idsFrom("nope").length === 0,
  "and a shape nobody expected yields nothing rather than throwing on the way to writing somebody's notes");
ok(idsFrom({ data: [{ id: " a " }, { id: "" }, {}] }).join(",") === "a",
  "blank and malformed entries are dropped, not turned into a model called undefined");

// ── the lists themselves ─────────────────────────────────────────────────
ok(!PREFERRED.includes("anthropic/claude-3.5-sonnet"),
  "the retired id is not in the preference list — the bug does not get to come back through the front door");
ok(PREFERRED.length >= 4 && PREFERRED_OPENAI.length >= 2,
  "both providers have a real chain, not a single point of failure wearing a list's clothing");
ok(PREFERRED.every((m) => m.includes("/")) && PREFERRED_OPENAI.every((m) => !m.includes("/")),
  "OpenRouter ids are namespaced and OpenAI ids are not — sending one provider the other's naming is a 404 that reads like an outage");
ok(MODELS_URL.openrouter.startsWith("https://openrouter.ai") && MODELS_URL.openai.startsWith("https://api.openai.com"),
  "and each provider is asked about its own models");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
