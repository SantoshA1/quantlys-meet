// Which model writes the notes.
//
// FIELD 2026-08-18: he added a working OPENROUTER_API_KEY, the setup check
// went green — "OpenRouter accepted your key" — and every model-backed feature
// was still dead. The key was fine. The MODEL ID was not:
//
//   {"error":{"message":"No endpoints found for anthropic/claude-3.5-sonnet.","code":404}}
//
// The app had that string hardcoded as its default in four routes. The vendor
// retired the model, and a line of code written months earlier quietly stopped
// working — with a green tick beside it, because "can I reach the provider"
// and "will the thing I ask for exist" are different questions and only the
// first was being asked.
//
// THE FIX IS NOT A NEWER STRING. A newer string has the same expiry date; it
// just hasn't arrived yet. The fix is to stop naming one model and start
// naming a PREFERENCE, then resolve it against what the provider actually
// offers at the moment of asking. A retired model then costs you the next
// item on the list instead of the feature.

/** In order. The list is the product decision — the resolver is mechanics.
 *
 *  Reading a messy meeting transcript and pulling out what was decided is a
 *  comprehension task, not a generation task, so the mid-tier models earn
 *  their keep here and the cheap ones genuinely do worse. The tail exists so
 *  that a person with any provider at all still gets notes. */
export const PREFERRED: string[] = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-3-haiku",
  "openai/gpt-4o-mini",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-70b-instruct",
];

/** OpenAI's own API, which names its models differently. */
export const PREFERRED_OPENAI: string[] = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"];

export type Pick = { id: string; why: string; exact: boolean };

/** Choose a model, given what the provider says it has.
 *
 *  `wanted` is the operator's NOTES_MODEL. It wins when it exists — that is
 *  the whole point of an override. When it does not exist we fall through
 *  rather than failing, and we say so: silently ignoring somebody's explicit
 *  configuration is its own kind of lie, and so is dying because of a typo. */
export function pickModel(available: string[], wanted?: string, prefer: string[] = PREFERRED): Pick {
  const have = new Set((available || []).map((m) => String(m || "").trim()).filter(Boolean));
  const want = String(wanted || "").trim();

  if (want) {
    if (!have.size) return { id: want, why: `Using NOTES_MODEL (${want}).`, exact: true };
    if (have.has(want)) return { id: want, why: `Using NOTES_MODEL (${want}).`, exact: true };
    const next = prefer.find((p) => have.has(p));
    if (next) {
      return {
        id: next,
        why: `NOTES_MODEL is set to "${want}", which this provider doesn't offer — used ${next} instead. Check the name, or remove NOTES_MODEL to let the app choose.`,
        exact: false,
      };
    }
  }

  // No list at all means the provider wouldn't tell us. Ask for the first
  // preference and let the call itself be the test — better than refusing to
  // try because a secondary endpoint was down.
  if (!have.size) {
    return { id: prefer[0], why: `Couldn't list models, so tried ${prefer[0]}.`, exact: false };
  }

  const best = prefer.find((p) => have.has(p));
  if (best) return { id: best, why: `Chose ${best}.`, exact: false };

  // Nothing we know of. Take anything before taking nothing — a provider with
  // 400 models and none on our list is a list that has aged, not an outage.
  const any = Array.from(have).sort()[0];
  return {
    id: any,
    why: `None of the preferred models are available here — used ${any}. Set NOTES_MODEL if you want a specific one.`,
    exact: false,
  };
}

/** Turn a provider's model listing into plain ids, whatever shape it arrives
 *  in. OpenRouter answers {data:[{id}]}; OpenAI answers {data:[{id}]} too, but
 *  neither promises to keep doing so. */
export function idsFrom(payload: any): string[] {
  const rows = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
    : Array.isArray(payload) ? payload : [];
  return rows
    .map((m: any) => (typeof m === "string" ? m : String(m?.id || m?.name || "")))
    .map((s: string) => s.trim())
    .filter(Boolean);
}

// ── the resolver ──────────────────────────────────────────────────────────
//
// Cached, because this runs on the way to writing every set of notes and the
// answer changes about twice a year. Short enough that a newly-added model
// shows up the same day; long enough that it costs nothing.

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; ids: string[]; endpoint: string } | null = null;

export async function availableModels(endpoint: string, key: string): Promise<string[]> {
  if (cache && cache.endpoint === endpoint && Date.now() - cache.at < TTL_MS) return cache.ids;
  try {
    const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return cache?.endpoint === endpoint ? cache.ids : [];
    const ids = idsFrom(await r.json());
    if (ids.length) cache = { at: Date.now(), ids, endpoint };
    return ids;
  } catch {
    // A listing we cannot reach is not the same as a provider that is down.
    return cache?.endpoint === endpoint ? cache.ids : [];
  }
}

export const MODELS_URL = {
  openrouter: "https://openrouter.ai/api/v1/models",
  openai: "https://api.openai.com/v1/models",
};

/** What every route calls. Returns the id to send and the sentence to show if
 *  the choice was not the one that was asked for. */
export async function chooseModel(opts: {
  openrouter: boolean;
  key: string;
  wanted?: string;
}): Promise<Pick> {
  const list = await availableModels(
    opts.openrouter ? MODELS_URL.openrouter : MODELS_URL.openai,
    opts.key
  );
  return pickModel(list, opts.wanted, opts.openrouter ? PREFERRED : PREFERRED_OPENAI);
}
