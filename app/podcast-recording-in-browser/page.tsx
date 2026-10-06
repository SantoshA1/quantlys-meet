import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";

const path = "/podcast-recording-in-browser";
const title = "Podcast recording in the browser | Quantlys Meeting";
const description =
  "Record a remote podcast in a browser tab. Guests join from a link. Get HD 720p video (MP4/WebM), .vtt/.srt captions, m4a audio, WAV clips, chapter notes.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: podcast recording in the browser");

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description}>
      <section className="qml-hero">
        <p className="qml-kicker">Memory mode · podcasts</p>
        <h1>Podcast recording in the browser</h1>
        <p className="qml-lede">
          Send your guest a link. They join from a browser tab with no app
          and no account. Record with captions on, and Memory mode gives you
          the episode as video, captions, audio, clips, and chapter notes.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Open host console
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/memory-mode">
            How Memory mode works
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>Recording an episode</h2>
        <ol>
          <li>In the host console, start a Memory session and give it a project (your show).</li>
          <li>Send the link. The guest does a device check and joins from the browser.</li>
          <li>Turn captions on and press record. Both sides see the recording badge.</li>
          <li>After the call, build the Memory package: chapters, quotes, summary.</li>
        </ol>

        <h2>What you get per episode</h2>
        <div className="qml-tablewrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Full video</td>
                <td>One continuous HD 720p take (1280×720, 24fps). MP4 in Chrome, Edge, and Safari; WebM in Firefox</td>
              </tr>
              <tr>
                <td>Captions</td>
                <td><code>.vtt</code> or <code>.srt</code>, for YouTube, Descript, or Premiere</td>
              </tr>
              <tr>
                <td>Audio</td>
                <td>Full episode as <strong>m4a</strong> (or audio.webm)</td>
              </tr>
              <tr>
                <td>Clips</td>
                <td><strong>WAV</strong> chapter and quote cuts, when timed captions exist</td>
              </tr>
              <tr>
                <td>Show notes</td>
                <td>Markdown: summary, chapters, quotes, open threads</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          No MOV and no 1080p or 4K. We only list what the recorder writes.
        </p>

        <h2>When to use something else</h2>
        <p>
          Quantlys records one composite take in the host&rsquo;s browser,
          and remote guests come through as their network feed at up to 720p.
          Dedicated podcast tools such as Riverside or Zencastr record each
          guest locally on their own machine and upload separate tracks
          afterwards. If you need per-speaker tracks for a heavy edit, or
          guests on unreliable connections, use one of those.
        </p>
        <p>
          Quantlys is for a different job: a conversation where you want the
          episode, the captions, and the written outline in one place with no
          extra transcription step. That works for interview shows, internal
          podcasts, and oral history.
        </p>

        <h2>Series, books, oral history</h2>
        <p>
          Sessions under one project roll up together, so you can reorder
          episodes and generate chapter headings across a series. The same
          flow covers a{" "}
          <Link href="/memory-mode">book drafted from conversations or an oral-history recording</Link>{" "}
          with a parent or elder.
        </p>

        <h2>Hosted or self-hosted</h2>
        <p>
          Use it at quantlys-meeting.com, or{" "}
          <Link href="/self-hosted-video-conferencing">self-host</Link> with
          your own LiveKit, Deepgram, Supabase, and OpenAI/OpenRouter keys.
          The source is MIT on GitHub. For product meetings instead of
          episodes, see the{" "}
          <Link href="/ai-meeting-assistant-prd">AI meeting assistant that writes the PRD</Link>.
        </p>
      </article>
    </IntentShell>
  );
}
