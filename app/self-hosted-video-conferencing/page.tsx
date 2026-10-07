import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";

const path = "/self-hosted-video-conferencing";
const title = "Self-hosted video conferencing | Quantlys Meeting";
const description =
  "Run browser video conferencing on your own keys: LiveKit Cloud or your own SFU, Supabase, Deepgram, OpenAI/OpenRouter. What stays on-prem and what doesn't.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: self-hosted video conferencing");

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description}>
      <section className="qml-hero">
        <p className="qml-kicker">Your servers · your keys · MIT</p>
        <h1>Self-hosted video conferencing</h1>
        <p className="qml-lede">
          Quantlys Meeting is a Next.js app you can deploy yourself. It is the
          same code that runs quantlys-meeting.com. This page is the
          operator&rsquo;s view: the parts, the three ways to deploy, and an
          honest account of which data leaves your network.
        </p>
        <div className="qml-cta">
          <a className="qml-btn qml-btn-primary" href="https://github.com/SantoshA1/quantlys-meet/blob/main/docs/SELF_HOST.md">
            Read SELF_HOST.md
          </a>
          <a className="qml-btn qml-btn-ghost" href="https://vercel.com/new/clone?repository-url=https://github.com/SantoshA1/quantlys-meet">
            Deploy to Vercel
          </a>
        </div>
      </section>

      <article className="qml-legal">
        <h2>Two layers</h2>
        <ol>
          <li>
            <strong>App and data:</strong> the Next.js app, Supabase (auth,
            history, recording storage), Deepgram (captions), and an OpenAI or
            OpenRouter key (PRD and Memory writers).
          </li>
          <li>
            <strong>Realtime media:</strong> a LiveKit SFU. Use LiveKit Cloud,
            or run the open-source <code>livekit-server</code> binary yourself.
          </li>
        </ol>
        <p>
          You can self-host the media layer and still use SaaS for the rest,
          then swap pieces out over time.
        </p>

        <h2>Three deployment paths</h2>
        <div className="qml-tablewrap">
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Media</th>
                <th>Good for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A. Fastest</td>
                <td>LiveKit Cloud</td>
                <td>Getting a working room on your own domain in an afternoon</td>
              </tr>
              <tr>
                <td>B. Own SFU</td>
                <td>Your <code>livekit-server</code> (config in <code>selfhost/</code>)</td>
                <td>Keeping audio and video off a third-party media cloud</td>
              </tr>
              <tr>
                <td>C. White-label</td>
                <td>Either</td>
                <td>Running it as your own product: your domain, branding, guest policy</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Local smoke test</h2>
        <p>
          <code>git clone</code>, copy <code>.env.example</code> to{" "}
          <code>.env.local</code>, fill the keys, run{" "}
          <code>supabase/schema.sql</code> on your project, then{" "}
          <code>npm install &amp;&amp; npm run dev</code>. Joining a room only
          needs LiveKit. Captions, history, recording, and the PRD each light
          up when you add their key.
        </p>

        <h2>What stays on your network, and what doesn&rsquo;t</h2>
        <p>
          Running your own SFU keeps <em>media</em> on your servers. It does
          not keep <em>words</em> there. Captions go to Deepgram and PRD or
          Memory writing goes to your model provider unless you point those at
          something you run. The app reports this in code
          (<code>dataLeaving()</code> in <code>lib/hosting.ts</code>), so you
          can see by name which vendors receive data.
        </p>

        <h2>Recording on your own storage</h2>
        <p>
          The room records one continuous HD 720p file (1280×720, 24fps) in
          the host&rsquo;s browser, about 19 MB per minute, and uploads it
          resumably to your Supabase Storage. Raise the Storage upload limit
          above your longest take. Supabase&rsquo;s Free plan caps files at
          50 MB, about 2 to 3 minutes. If storage refuses a take, the host can
          still download it from the tab.
        </p>

        <h2>Operator checklist</h2>
        <ul>
          <li>Set <code>APP_URL</code> to your domain</li>
          <li>
            Decide guest policy: <code>ALLOW_GUEST_JOIN</code> (default on;
            see <Link href="/browser-video-meeting-no-download">no-download guest join</Link>)
          </li>
          <li>Optionally restrict hosts to one email domain with <code>ALLOWED_EMAIL_DOMAIN</code></li>
          <li>Private bucket for recordings; rotate any key that touched a demo</li>
        </ul>

        <h2>Related</h2>
        <ul>
          <li><Link href="/open-source-zoom-alternative">Open-source Zoom alternative</Link>: comparison table</li>
          <li><Link href="/open-source-video-meeting">Open-source video conferencing software</Link>: product overview</li>
          <li><Link href="/podcast-recording-in-browser">Podcast recording in the browser</Link></li>
        </ul>
      </article>
    </IntentShell>
  );
}
