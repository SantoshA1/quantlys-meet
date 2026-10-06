import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";

const path = "/open-source-zoom-alternative";
const title = "Open-source Zoom alternative | Quantlys Meeting";
const description =
  "An MIT-licensed browser meeting app you can self-host. Honest comparison with Zoom, Jitsi Meet, and BigBlueButton, and the keys you bring to run it.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: open-source Zoom alternative");

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description}>
      <section className="qml-hero">
        <p className="qml-kicker">MIT · self-host · bring your keys</p>
        <h1>Open-source Zoom alternative</h1>
        <p className="qml-lede">
          Quantlys Meeting is an MIT-licensed browser video meeting app. You
          can use it hosted at quantlys-meeting.com or clone it and run it on
          your own keys. It does not try to match all of Zoom. It does small
          working sessions well, and the recorded session writes a markdown
          PRD instead of a transcript.
        </p>
        <div className="qml-cta">
          <a className="qml-btn qml-btn-primary" href="https://github.com/SantoshA1/quantlys-meet">
            Source on GitHub
          </a>
          <Link className="qml-btn qml-btn-ghost" href="/self-hosted-video-conferencing">
            How self-hosting works
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>Honest comparison</h2>
        <p>
          If you just want an open-source Zoom alternative for general video
          calls, Jitsi Meet and BigBlueButton are older and more widely
          deployed. Pick Quantlys if you want the output of the meeting (a
          spec, or a podcast package) more than the meeting itself.
        </p>
        <div className="qml-tablewrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Quantlys Meeting</th>
                <th>Zoom</th>
                <th>Jitsi Meet</th>
                <th>BigBlueButton</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>License</td>
                <td>MIT</td>
                <td>Proprietary</td>
                <td>Apache 2.0</td>
                <td>LGPL</td>
              </tr>
              <tr>
                <td>Self-host</td>
                <td>Yes (Next.js + your service keys)</td>
                <td>No</td>
                <td>Yes</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Guests join in browser</td>
                <td>Yes, name only</td>
                <td>Web client available</td>
                <td>Yes</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Built for</td>
                <td>Product reviews → PRD; podcasts / oral history</td>
                <td>Everything, at scale</td>
                <td>General calls</td>
                <td>Online classes</td>
              </tr>
              <tr>
                <td>What you leave with</td>
                <td>Markdown PRD, or video + captions + audio + .md</td>
                <td>Recording, transcript, AI summary</td>
                <td>Recording (with setup)</td>
                <td>Recording, slides, chat</td>
              </tr>
              <tr>
                <td>Webinars, dial-in, room systems</td>
                <td>No</td>
                <td>Yes</td>
                <td>Partial</td>
                <td>Partial</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The rows for other products are general descriptions, not a feature
          audit. Check their docs for your case.
        </p>

        <h2>What you bring</h2>
        <p>
          Quantlys is not one binary. It is a Next.js 14 app that calls
          services you hold the keys to:
        </p>
        <ul>
          <li><strong>LiveKit</strong>: realtime media (LiveKit Cloud or your own SFU)</li>
          <li><strong>Supabase</strong>: host sign-in, meeting history, recording storage</li>
          <li><strong>Deepgram</strong>: live captions and transcripts</li>
          <li><strong>OpenAI or OpenRouter</strong>: PRD and Memory writers</li>
          <li><strong>Vercel</strong> or any Node host that runs Next.js</li>
        </ul>
        <p>
          You pay those vendors directly at their prices. Quantlys adds no
          license fee. The full checklist is on{" "}
          <Link href="/self-hosted-video-conferencing">self-hosted video conferencing</Link>.
        </p>

        <h2>What you give up versus Zoom</h2>
        <ul>
          <li>No desktop or mobile apps; browser only.</li>
          <li>No webinars, breakout rooms, phone dial-in, or room hardware.</li>
          <li>Recording is HD 720p, one composite file, not per-speaker tracks.</li>
          <li>You run it yourself, or trust a small hosted deployment.</li>
        </ul>

        <h2>What you get</h2>
        <ul>
          <li>
            Source you can read and change, under a license that lets you
            white-label it.
          </li>
          <li>
            A room that writes the spec:{" "}
            <Link href="/meeting-that-writes-prd">meeting that writes a PRD</Link>.
          </li>
          <li>
            <Link href="/memory-mode">Memory mode</Link> for podcasts, books,
            and oral history.
          </li>
          <li>
            <Link href="/browser-video-meeting-no-download">Guests need a link, not an app</Link>.
          </li>
        </ul>
        <p>
          Product overview: <Link href="/open-source-video-meeting">open-source video meeting</Link>.
          Built by Santosh Adari as dogfood for{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a>.
        </p>
      </article>
    </IntentShell>
  );
}
