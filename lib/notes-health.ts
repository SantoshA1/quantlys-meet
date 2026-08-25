// What has to be true for a recording to turn into notes in your inbox — and
// the plain-English reason when it isn't.
//
// FIELD 2026-08-17. The finish route was written so that every optional step
// swallows its own failure: "notes are a bonus; the recording is the product."
// That is the right INSTINCT and the wrong OUTCOME. A host pressed Record,
// got "Saved 48 MB", and never received an email — with nothing anywhere in
// the product able to say whether the key was missing, the key was wrong, or
// nobody had spoken loudly enough to transcribe. Silence is not a graceful
// degrade; it is a bug you cannot report.
//
// So every step now says what happened and, when it didn't happen, what to do
// about it — in the same words whether you ask BEFORE a meeting ("check my
// setup") or read it AFTER one.

import { chooseModel } from "@/lib/model";
import { whereToSetEnv } from "@/lib/hosting";

export type Step = {
  // "names" joined 2026-08-25: putting the real name on each voice is its own
  // step, and its own thing to succeed or fail at, because "Speaker 2" has
  // several possible causes and a person deserves to be told which one.
  key: "transcribe" | "names" | "notes" | "email" | "storage" | "items" | "meeting" | "recording";
  label: string;
  ok: boolean;
  detail: string;
};

export const NOT_SET = (envVar: string, what: string) =>
  `${envVar} isn't set, so ${what}. ${whereToSetEnv()}`;

/** Deepgram: is the key present, and does Deepgram accept it? */
export async function checkTranscribe(): Promise<Step> {
  const base: Step = { key: "transcribe", label: "Turn speech into text", ok: false, detail: "" };
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return { ...base, detail: NOT_SET("DEEPGRAM_API_KEY", "nothing can be transcribed and there is nothing to summarise") };
  }
  try {
    const r = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    if (r.status === 401 || r.status === 403) {
      return { ...base, detail: "Deepgram rejected this key. It may have been revoked or copied with a space in it — make a new one and replace DEEPGRAM_API_KEY." };
    }
    if (!r.ok) {
      return { ...base, detail: `Deepgram answered ${r.status}. The key looks fine; their service may be having a moment. Try again in a few minutes.` };
    }
    return { ...base, ok: true, detail: "Deepgram accepted your key." };
  } catch {
    return { ...base, detail: "Couldn't reach Deepgram at all — a network or firewall problem, not a key problem." };
  }
}

/** OpenRouter/OpenAI: optional. Without it you still get notes, just blunter. */
export async function checkNotes(): Promise<Step> {
  const base: Step = { key: "notes", label: "Write the summary and action items", ok: false, detail: "" };
  const or = process.env.OPENROUTER_API_KEY;
  const oa = process.env.OPENAI_API_KEY;
  if (!or && !oa) {
    return {
      ...base,
      ok: true,
      detail: "No OPENROUTER_API_KEY or OPENAI_API_KEY, so the notes are written by pattern-matching the transcript rather than by a model. You still get a summary and action items — they are just blunter. This is a choice, not a fault.",
    };
  }
  try {
    if (or) {
      const r = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${or}` },
      });
      if (r.status === 401 || r.status === 403) {
        return { ...base, detail: "OpenRouter rejected this key — the notes would fall back to pattern-matching. Replace OPENROUTER_API_KEY." };
      }
      if (!r.ok) return { ...base, detail: `OpenRouter answered ${r.status}; notes would fall back to pattern-matching.` };
      // FIELD 2026-08-18: this used to stop here, at "your key works", and go
      // green — while every model-backed feature returned
      // `No endpoints found for anthropic/claude-3.5-sonnet`. "Can I reach the
      // provider" and "does the thing I am about to ask for exist" are
      // different questions, and a check that only asks the first is a green
      // tick over a dead feature. Name the model that would actually be used,
      // resolved exactly the way the routes resolve it.
      const pick = await chooseModel({ openrouter: true, key: or, wanted: process.env.NOTES_MODEL });
      return {
        ...base,
        ok: true,
        detail: /^Chose |^Using /.test(pick.why)
          ? `OpenRouter accepted your key. Notes will be written by ${pick.id}.`
          : `OpenRouter accepted your key. ${pick.why}`,
      };
    }
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${oa}` },
    });
    if (!r.ok) return { ...base, detail: `OpenAI answered ${r.status}; notes would fall back to pattern-matching.` };
    const pick = await chooseModel({ openrouter: false, key: oa!, wanted: process.env.NOTES_MODEL });
    return {
      ...base,
      ok: true,
      detail: /^Chose |^Using /.test(pick.why)
        ? `OpenAI accepted your key. Notes will be written by ${pick.id}.`
        : `OpenAI accepted your key. ${pick.why}`,
    };
  } catch {
    return { ...base, detail: "Couldn't reach the notes model; notes would fall back to pattern-matching." };
  }
}

/** Resend: the step that fails most quietly, because email failing looks
 *  exactly like email being slow. */
export async function checkEmail(): Promise<Step> {
  const base: Step = { key: "email", label: "Email you the notes and a link", ok: false, detail: "" };
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ...base, detail: NOT_SET("RESEND_API_KEY", "nothing can be emailed — the notes are still saved on your host page") };
  }
  const from = process.env.RESEND_FROM || "";
  try {
    const r = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 401 || r.status === 403) {
      return { ...base, detail: "Resend rejected this key. Make a new one at resend.com → API Keys and replace RESEND_API_KEY." };
    }
    if (!r.ok) {
      return { ...base, detail: `Resend answered ${r.status}. Try again shortly.` };
    }
    // The domain in RESEND_FROM has to be one Resend has verified, or every
    // send is refused at the moment of sending — long after you'd notice.
    const j: any = await r.json().catch(() => ({}));
    const domains: any[] = j?.data || [];
    const m = /<([^>]+)>/.exec(from) || [];
    const address = (m[1] || from).trim();
    const domain = address.includes("@") ? address.split("@")[1].toLowerCase() : "";
    if (!from) {
      return {
        ...base,
        ok: true,
        detail: "Resend accepted your key. RESEND_FROM isn't set, so mail goes out as onboarding@resend.dev — that works for testing and looks like a test.",
      };
    }
    if (domain && domain !== "resend.dev") {
      const found = domains.find((d) => String(d?.name || "").toLowerCase() === domain);
      if (!found) {
        return { ...base, detail: `Resend accepted your key, but "${domain}" (from RESEND_FROM) is not a domain on this Resend account — every send would be refused. Add and verify it at resend.com → Domains, or change RESEND_FROM.` };
      }
      if (String(found.status || "").toLowerCase() !== "verified") {
        return { ...base, detail: `"${domain}" is on your Resend account but its status is "${found.status}", not verified — sends are refused until the DNS records are in place.` };
      }
    }
    return { ...base, ok: true, detail: `Resend accepted your key and will send as ${address}.` };
  } catch {
    return { ...base, detail: "Couldn't reach Resend at all — a network problem, not a key problem." };
  }
}

/** The one non-optional step: somewhere to put the file. */
export function checkStorage(): Step {
  const base: Step = { key: "storage", label: "Save the recording", ok: false, detail: "" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...base, detail: NOT_SET("SUPABASE_SERVICE_ROLE_KEY", "the server can't write the notes beside your recording") };
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ...base, detail: NOT_SET("NEXT_PUBLIC_SUPABASE_URL", "there is nowhere to save anything") };
  }
  return { ...base, ok: true, detail: "Recordings and notes have somewhere to live." };
}

/** One line a human can read at a glance, from any set of steps. */
export function headline(steps: Step[]): string {
  const broken = steps.filter((s) => !s.ok);
  if (!broken.length) return "Everything a recording needs is in place.";
  if (broken.length === 1) return `One thing would not work: ${broken[0].label.toLowerCase()}.`;
  return `${broken.length} things would not work: ${broken.map((s) => s.label.toLowerCase()).join(", ")}.`;
}
