// Captions out of the room: WebVTT / SRT from the timed lines a recording's
// summary already keeps (`utterances`: { start, end?, speaker?, transcript }).
//
// These are the SAME lines "ask this meeting" cites, so a caption file and an
// answer always agree on when something was said. Lines without a start time
// are skipped — a caption file with invented timings is worse than none.
//
// ZERO-IMPORT so it stays offline-testable.

export type TimedLine = {
  start?: number; end?: number; speaker?: number | string;
  /** Named voice from lib/speakers.ts ("Maya"), when the finish step had one. */
  who?: string;
  transcript?: string; text?: string;
};
export type CaptionFormat = "vtt" | "srt";

export function acceptCaptionFormat(raw: unknown): CaptionFormat {
  return String(raw || "").toLowerCase() === "srt" ? "srt" : "vtt";
}

function clock(sec: number, sep: "." | ","): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}${sep}${String(r).padStart(3, "0")}`;
}

type Cue = { start: number; end: number; text: string };

/** Clean, ordered cues. End defaults to the next start (max 7s), min 1s. */
export function captionCues(lines: TimedLine[]): Cue[] {
  const rows = (Array.isArray(lines) ? lines : [])
    .map((l) => {
      const start = Number(l?.start);
      const text = String(l?.transcript ?? l?.text ?? "").replace(/\s+/g, " ").trim();
      if (!Number.isFinite(start) || start < 0 || !text) return null;
      const end = Number(l?.end);
      const named = typeof l?.who === "string" ? l.who.trim() : "";
      // "Speaker 2" is a label, not a name — leave it off the caption.
      const who = named && !/^speaker\s*\d+$/i.test(named) ? named : "";
      return { start, end: Number.isFinite(end) && end > start ? end : NaN, text: who ? `${who}: ${text}` : text };
    })
    .filter(Boolean) as Array<{ start: number; end: number; text: string }>;
  rows.sort((a, b) => a.start - b.start);
  return rows.map((r, i) => {
    const next = rows[i + 1]?.start;
    let end = Number.isFinite(r.end) ? r.end : Math.min(r.start + 7, next ?? r.start + 4);
    if (end - r.start < 1) end = r.start + 1;
    return { start: r.start, end, text: r.text };
  });
}

export function toVtt(lines: TimedLine[]): string {
  const cues = captionCues(lines);
  return "WEBVTT\n\n" + cues.map((c, i) =>
    `${i + 1}\n${clock(c.start, ".")} --> ${clock(c.end, ".")}\n${c.text}\n`
  ).join("\n");
}

export function toSrt(lines: TimedLine[]): string {
  const cues = captionCues(lines);
  return cues.map((c, i) =>
    `${i + 1}\n${clock(c.start, ",")} --> ${clock(c.end, ",")}\n${c.text}\n`
  ).join("\n");
}

export function captionsFile(lines: TimedLine[], format: CaptionFormat): string {
  return format === "srt" ? toSrt(lines) : toVtt(lines);
}

export function captionMime(format: CaptionFormat): string {
  return format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8";
}
