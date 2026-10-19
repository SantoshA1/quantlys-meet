// Which voices are in the recording.
//
// FIELD 2026-10-19 (demo rehearsal): a two-person spec session saved an audio
// file with only the host in it — the guest sat at -91 dB — so the PRD was
// written from half the conversation. The recorder mixed the page's <audio>
// elements through createMediaElementSource, which in Chrome yields silence
// for a remote WebRTC stream, and it only looked once, at Record, so anyone
// who joined later wasn't in it either.
//
// Now the mix is built from the LiveKit tracks themselves (their
// MediaStreamTracks, through createMediaStreamSource) and reconciled for as
// long as the take runs: a late joiner, a republished mic, a device switch or
// a screen share's audio joins the mix; a track that ends leaves it.

export type MixDiff = { add: string[]; remove: string[] };

/** What to connect and disconnect so the mix holds exactly `want`. */
export function diffSources(have: Iterable<string>, want: Iterable<string>): MixDiff {
  const h = new Set(have);
  const w = new Set(want);
  return {
    add: [...w].filter((id) => !h.has(id)),
    remove: [...h].filter((id) => !w.has(id)),
  };
}

type TrackLike = { id: string; readyState?: string; kind?: string } | null | undefined;
type PubLike = { isSubscribed?: boolean; track?: { mediaStreamTrack?: TrackLike } | null };

/** Live audio tracks to record: every subscribed remote audio publication
 *  (mic and screen-share audio) plus my own microphone. */
export function wantedAudio(
  remote: Array<{ audioTrackPublications: { forEach: (f: (p: PubLike) => void) => void } }>,
  localMic?: TrackLike
): Map<string, NonNullable<TrackLike>> {
  const out = new Map<string, NonNullable<TrackLike>>();
  const take = (t: TrackLike) => {
    if (t && t.id && t.readyState !== "ended" && (!t.kind || t.kind === "audio")) out.set(t.id, t);
  };
  for (const p of remote) {
    try {
      p.audioTrackPublications.forEach((pub) => {
        if (pub?.isSubscribed !== false) take(pub?.track?.mediaStreamTrack);
      });
    } catch { /* a participant mid-leave must not stop the take */ }
  }
  take(localMic);
  return out;
}
