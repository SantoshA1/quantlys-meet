// The fake cloud: Supabase and the model provider, offline and deterministic.
//
// MAYA DOCTRINE V2-1 — every response here traces to a captured real one, not
// to memory:
//
//  · OpenRouter's retired-model 404 body is the one from FIELD 2026-08-18,
//    quoted verbatim in lib/model.ts: {"error":{"message":"No endpoints found
//    for anthropic/claude-3.5-sonnet.","code":404}}. That is the failure that
//    cost every model-backed feature in this app while the setup check stayed
//    green, and it is why the model list is asked for rather than assumed.
//  · The models listing is {"data":[{"id":...}]}, which is the shape
//    lib/model.ts's idsFrom() was written against for both providers.
//  · The chat completion is {"choices":[{"message":{"content":"..."}}]}.
//
// The Supabase half is a store, not a mock of a client: routes call list,
// download and upload, and the suite asserts on what actually landed.

export const CLOUD = {
  user: { id: "u1", email: "maya@quantlys.local" },
  token: "good",
  files: {},        // path -> string contents
  listing: {},      // prefix -> [{name, id?}]
  uploads: [],      // {path, body}
  calls: [],        // every model request the routes made
  listCalls: 0,     // how often the routes asked the provider what it has
  models: ["anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5", "openai/gpt-4o-mini"],
  chat: null,       // (body) => {status, json} — set per check
};

export function reset(patch = {}) {
  CLOUD.files = {}; CLOUD.listing = {}; CLOUD.uploads = []; CLOUD.calls = []; CLOUD.listCalls = 0;
  CLOUD.user = { id: "u1", email: "maya@quantlys.local" };
  CLOUD.models = ["anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5", "openai/gpt-4o-mini"];
  CLOUD.chat = null;
  Object.assign(CLOUD, patch);
}

export function createClient() {
  return {
    auth: {
      getUser: async (jwt) => ({ data: { user: jwt === CLOUD.token ? CLOUD.user : null } }),
      admin: { getUserById: async () => ({ data: { user: CLOUD.user } }) },
    },
    storage: {
      from: () => ({
        list: async (prefix) => ({ data: CLOUD.listing[prefix] || [], error: null }),
        download: async (p) =>
          Object.prototype.hasOwnProperty.call(CLOUD.files, p)
            ? { data: { text: async () => CLOUD.files[p] }, error: null }
            : { data: null, error: { message: "Object not found" } },
        upload: async (p, blob) => {
          const body = typeof blob?.text === "function" ? await blob.text() : String(blob);
          CLOUD.uploads.push({ path: p, body });
          CLOUD.files[p] = body;
          return { data: { path: p }, error: null };
        },
        createSignedUrl: async () => ({ data: { signedUrl: "https://example/signed" }, error: null }),
      }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  };
}

/** Stand in for the network. Installed as globalThis.fetch by the suites. */
export async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (/\/v1\/models$/.test(u)) {
    CLOUD.listCalls++;
    return json(200, { data: CLOUD.models.map((id) => ({ id })) });
  }
  if (/chat\/completions$/.test(u)) {
    const body = JSON.parse(String(init.body || "{}"));
    CLOUD.calls.push(body);
    const r = CLOUD.chat ? CLOUD.chat(body) : { status: 200, body: content("{}") };
    if (r.status !== 200) return json(r.status, r.body);
    return json(200, r.body);
  }
  throw new Error(`the suite tried to reach ${u} — nothing should leave the machine`);
}

export const content = (text) => ({ choices: [{ message: { content: text } }] });

/** The captured OpenRouter body for a model that no longer exists. */
export const RETIRED_MODEL_404 = {
  error: { message: "No endpoints found for anthropic/claude-3.5-sonnet.", code: 404 },
};

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
