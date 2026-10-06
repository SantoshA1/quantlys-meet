import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";

const path = "/browser-video-meeting-no-download";
const title = "Browser video meeting, no download | Quantlys Meeting";
const description =
  "Video meetings that run in a browser tab. Guests join from a link with just a name: no app, no account. Waiting room, screen share, captions, recording.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: browser video meeting, no download");

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description}>
      <section className="qml-hero">
        <p className="qml-kicker">A link, not an installer</p>
        <h1>Browser video meeting, no download</h1>
        <p className="qml-lede">
          Quantlys Meeting runs entirely in a browser tab. The host signs in
          with an email code; everyone else opens the link, types a name, and
          joins. No desktop client, no extension, no guest account.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/#join">
            Join with a link or code
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>What a guest actually does</h2>
        <ol>
          <li>Opens the invite link (or types the room code on the home page).</li>
          <li>
            Gets a device check: pick camera, microphone, and speaker, see
            their own preview, and confirm the mic is picking up sound before
            they go in.
          </li>
          <li>
            Ticks the &ldquo;this meeting may be recorded&rdquo; box, so
            nobody is recorded without being told.
          </li>
          <li>
            Clicks <strong>Join</strong>. If the host runs a waiting room, they
            wait to be admitted; otherwise they are in.
          </li>
        </ol>
        <p>
          That is the whole flow. The video and audio run over WebRTC through
          LiveKit, which is built into current Chrome, Edge, Firefox, and
          Safari, so there is nothing to install.
        </p>

        <h2>What is in the room</h2>
        <ul>
          <li>Video and audio, screen share, whiteboard, reactions</li>
          <li>Waiting room, room lock, and host admit</li>
          <li>Live captions (Deepgram)</li>
          <li>
            Recording at HD 720p: one continuous file, MP4 in Chrome, Edge,
            and Safari, WebM in Firefox. Everyone sees a recording badge.
          </li>
          <li>Calendar invite (.ics) from the host console</li>
        </ul>

        <h2>Honest comparison</h2>
        <div className="qml-tablewrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Quantlys Meeting</th>
                <th>Typical big-suite meeting app</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Guest install</td>
                <td>None: browser tab only</td>
                <td>Usually a web client exists, but the app is often pushed</td>
              </tr>
              <tr>
                <td>Guest account</td>
                <td>Not needed (a name is enough)</td>
                <td>Varies by product and org policy</td>
              </tr>
              <tr>
                <td>Large webinars, phone dial-in, rooms hardware</td>
                <td>Not offered</td>
                <td>Yes, and that is where they are strong</td>
              </tr>
              <tr>
                <td>After the call</td>
                <td>
                  A markdown <Link href="/meeting-that-writes-prd">PRD</Link> or a{" "}
                  <Link href="/memory-mode">Memory</Link> package
                </td>
                <td>Recording, transcript, AI summary</td>
              </tr>
              <tr>
                <td>Source code</td>
                <td>MIT, on GitHub</td>
                <td>Closed</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          If you need a 500-person webinar or phone dial-in, use the big
          suites. Quantlys is for small working sessions where the link should
          just work and the call should end with something you can ship.
        </p>

        <h2>Who turns guest access off</h2>
        <p>
          Guest join is on by default. If you{" "}
          <Link href="/self-hosted-video-conferencing">self-host</Link>, one
          environment flag (<code>ALLOW_GUEST_JOIN=false</code>) requires
          everyone to sign in. The waiting room and lock still apply on top
          when guests are allowed.
        </p>

        <h2>Related</h2>
        <ul>
          <li>
            <Link href="/open-source-zoom-alternative">Open-source Zoom alternative</Link>: what
            you get and give up
          </li>
          <li>
            <Link href="/podcast-recording-in-browser">Podcast recording in the browser</Link>
          </li>
          <li>
            <Link href="/ai-meeting-assistant-prd">AI meeting assistant that writes the PRD</Link>
          </li>
        </ul>
      </article>
    </IntentShell>
  );
}
