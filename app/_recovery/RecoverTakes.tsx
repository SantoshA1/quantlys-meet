"use client";
// Unfinished recordings from a tab that died — found, and saved.
//
// See lib/take-store.ts for how they get here. This is the other half: on the
// next page that loads for the same account, list the takes nobody is looking
// after any more and upload them through the same path a normal Stop uses
// (storage, then /api/recording/finish), so the summary, PRD and Memory story
// are written from them like any other recording.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAGE_ID, describeTake, deleteTake, isRecoverable, listTakes, locksAvailable,
  orderedParts, readChunks, recoveryFinishBody, recoveryPaths, takeLockFree,
  withFreeTakeLock, MIN_TAKE_BYTES, patchTake, type TakeMeta,
} from "@/lib/take-store";
import { RESUMABLE_THRESHOLD_BYTES, resumableEndpoint, resumableUpload } from "@/lib/recording-quality";

type Row = { meta: TakeMeta; state: "idle" | "busy" | "done" | "err" | "confirm"; text: string };

const already = (status: number | undefined, msg: string) =>
  status === 409 || /already exists|duplicate/i.test(msg || "");

type Put = { err: string; existed: boolean };

async function put(client: SupabaseClient, path: string, blob: Blob, onPct?: (p: number) => void): Promise<Put> {
  if (blob.size > RESUMABLE_THRESHOLD_BYTES && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const { data } = await client.auth.getSession();
    const res = await resumableUpload({
      endpoint: resumableEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL),
      token: data.session?.access_token ?? "",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      bucket: "recordings",
      objectName: path,
      blob,
      contentType: blob.type,
      onProgress: (s, t) => onPct?.(Math.floor((s / Math.max(1, t)) * 100)),
    });
    if (res.ok) return { err: "", existed: false };
    return already(res.status, res.error) ? { err: "", existed: true } : { err: res.error, existed: false };
  }
  const up = await client.storage.from("recordings").upload(path, blob, { contentType: blob.type, upsert: false });
  if (!up.error) return { err: "", existed: false };
  const st = (up.error as any)?.statusCode ? Number((up.error as any).statusCode) : undefined;
  return already(st, up.error.message)
    ? { err: "", existed: true }
    : { err: up.error.message || "Upload failed.", existed: false };
}

/** Did the dying tab get as far as writing the summary? Then don't write (or email) it twice. */
async function hasSummary(client: SupabaseClient, videoPath: string): Promise<boolean> {
  try {
    const slash = videoPath.lastIndexOf("/");
    const dir = videoPath.slice(0, slash);
    const name = videoPath.slice(slash + 1).replace(/\.[a-z0-9]+$/i, "") + ".summary.json";
    const r = await client.storage.from("recordings").list(dir, { search: name, limit: 5 });
    return Boolean(r.data?.some((f) => f.name === name));
  } catch { return false; }
}

/** Upload one abandoned take. Returns "" on success, else what went wrong. */
export async function recoverTake(
  client: SupabaseClient, meta: TakeMeta, onStatus: (t: string) => void,
): Promise<string | null> {
  return withFreeTakeLock(meta.id, async () => {
    const chunks = await readChunks(meta.id);
    const vParts = orderedParts(chunks, "v");
    const aParts = orderedParts(chunks, "a");
    const video = vParts.length ? new Blob(vParts, { type: meta.vMime?.split(";")[0] || `video/${meta.vExt}` }) : null;
    const audio = aParts.length ? new Blob(aParts, { type: meta.aMime?.split(";")[0] || `audio/${meta.aExt}` }) : null;
    const hasV = Boolean(video && video.size >= MIN_TAKE_BYTES);
    const hasA = Boolean(audio && audio.size >= MIN_TAKE_BYTES);
    const { videoPath, audioPath } = recoveryPaths(meta, hasV, hasA);
    if (!videoPath) return "Nothing usable was kept for this take.";
    const primary = hasV ? video! : audio!;
    const mb = (primary.size / 1048576).toFixed(1);
    onStatus(`Uploading ${mb} MB…`);
    const { err, existed } = await put(client, videoPath, primary, (p) => onStatus(`Uploading ${mb} MB — ${p}%`));
    if (err) {
      await patchTake(meta.id, { lastError: err });
      return err;
    }
    let aPath: string | null = null;
    if (hasV && hasA && audioPath) {
      const a = await put(client, audioPath, audio!);
      if (!a.err) aPath = audioPath;
    }
    if (existed && (await hasSummary(client, videoPath))) {
      await deleteTake(meta.id);
      return "";
    }
    onStatus(`Saved ${mb} MB. Writing the ${meta.sessionMode === "memory" ? "story notes" : "summary"}…`);
    try {
      const { data: sess } = await client.auth.getSession();
      await fetch("/api/recording/finish", {
        method: "POST",
        keepalive: false,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify(recoveryFinishBody(meta, videoPath, aPath)),
      });
    } catch { /* the file is in storage; the summary can be regenerated from the host page */ }
    // The cloud has the file. The browser copy has done its job.
    await deleteTake(meta.id);
    return "";
  });
}

export default function RecoverTakes({ client, userId, auto = false }: {
  client: SupabaseClient | null; userId: string | null; auto?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const ran = useRef(false);

  const set = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.meta.id === id ? { ...r, ...patch } : r)));

  const upload = useCallback(async (meta: TakeMeta) => {
    if (!client) return;
    set(meta.id, { state: "busy", text: "Preparing…" });
    const out = await recoverTake(client, meta, (t) => set(meta.id, { text: t }));
    if (out === null) set(meta.id, { state: "idle", text: "Another tab is saving this one." });
    else if (out) set(meta.id, { state: "err", text: out });
    else set(meta.id, { state: "done", text: "Saved — it's under Recordings now." });
  }, [client]);

  useEffect(() => {
    if (!client || !userId || ran.current) return;
    ran.current = true;
    (async () => {
      const locks = locksAvailable();
      const all = await listTakes();
      const found: TakeMeta[] = [];
      for (const m of all) {
        if (!isRecoverable(m, { userId, pageId: PAGE_ID, locksAvailable: locks })) continue;
        if (locks && !(await takeLockFree(m.id))) continue;   // its tab is still alive
        found.push(m);
      }
      found.sort((a, b) => a.startedAt - b.startedAt);
      setRows(found.map((meta) => ({ meta, state: "idle", text: "" })));
      if (auto) for (const m of found) await upload(m);
    })();
  }, [client, userId, auto, upload]);

  const visible = rows.filter((r) => r.state !== "done" || r.text);
  if (!visible.length) return null;
  return (
    <div className="qm-recover" role="status" style={{
      border: "1px solid #5c4a1d", background: "#2a2312", color: "#ffe9b0",
      borderRadius: 10, padding: "10px 12px", margin: "10px 0", fontSize: 13, lineHeight: 1.45,
    }}>
      <b style={{ display: "block", marginBottom: 4 }}>
        Unfinished recording{visible.length > 1 ? "s" : ""} found in this browser
      </b>
      <span style={{ opacity: .85 }}>
        A tab closed before it finished saving. The pieces were kept on this device — upload them to get the recording and its notes.
      </span>
      {visible.map((r) => (
        <div key={r.meta.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <span style={{ flex: "1 1 260px" }}>{describeTake(r.meta)}{r.text ? <em style={{ opacity: .8 }}> — {r.text}</em> : null}</span>
          {r.state === "idle" || r.state === "err" ? (
            <>
              <button type="button" onClick={() => upload(r.meta)}
                style={{ background: "#ffd166", color: "#1b1405", border: 0, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                {r.state === "err" ? "Try again" : "Upload now"}
              </button>
              <button type="button" onClick={() => set(r.meta.id, { state: "confirm", text: "" })}
                style={{ background: "transparent", color: "#ffe9b0", border: "1px solid #6b5a2a", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                Discard
              </button>
            </>
          ) : r.state === "confirm" ? (
            <>
              <span>Delete this copy for good?</span>
              <button type="button" onClick={async () => { await deleteTake(r.meta.id); set(r.meta.id, { state: "done", text: "Discarded." }); }}
                style={{ background: "#7a2a33", color: "#fff", border: 0, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                Delete
              </button>
              <button type="button" onClick={() => set(r.meta.id, { state: "idle", text: "" })}
                style={{ background: "transparent", color: "#ffe9b0", border: "1px solid #6b5a2a", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                Keep
              </button>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
