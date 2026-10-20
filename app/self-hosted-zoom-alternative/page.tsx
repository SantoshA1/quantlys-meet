import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";
import {
  CompareJsonLd, CompareTable, FaqSection, HowWeCompared, PERSON_ID, REPO, SeeAlso, TrademarkNote,
  no, partial, txt, unlisted, yes, type Faq, type Row,
} from "../_seo/Compare";

const path = "/self-hosted-zoom-alternative";
const title = "Self-hosted Zoom alternative (MIT, open source) | Quantlys Meeting";
const description =
  "Run browser video meetings on your own LiveKit, Deepgram, Supabase and model keys. What you host, what still leaves your servers, and what Zoom does better.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: self-hosted, open-source Zoom alternative");

const SELF_HOST_DOC = `${REPO}/blob/main/docs/SELF_HOST.md`;

// Official Zoom pages, checked Oct 19, 2026.
const Z_MEETINGS = "https://www.zoom.com/en/products/virtual-meetings/";
const Z_WEBINARS = "https://www.zoom.com/en/products/webinars/";
const Z_DIAL_IN = "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060564";
const Z_SSO = "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060673";
const Z_FEATURES = "https://www.zoom.com/en/products/collaboration-tools/features/";

const rows: Row[] = [
  { label: "Source code license", cells: [yes("MIT"), unlisted(Z_MEETINGS)] },
  { label: "Run the app on your own infrastructure", cells: [yes("Vercel or any Node 22+ host"), unlisted(Z_MEETINGS)] },
  { label: "Run your own media server", cells: [yes("Your own LiveKit SFU, or LiveKit Cloud"), unlisted(Z_MEETINGS)] },
  { label: "Recordings in your own storage", cells: [
    partial("Supabase Storage / S3-compatible bucket; a bare SFU needs extra pieces", SELF_HOST_DOC),
    unlisted(Z_MEETINGS),
  ] },
  { label: "White-label (your domain, your brand)", cells: [yes("Allowed under MIT"), unlisted(Z_MEETINGS)] },
  { label: "Guests join in a browser with no account", cells: [yes("On by default; can require sign-in"), yes("Zoom Web App", "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064261")] },
  { label: "Waiting room, lock, host admit", cells: [yes(), yes(undefined, "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061231")] },
  { label: "Recording retention you control", cells: [yes("RECORDING_RETENTION_DAYS nightly job"), unlisted(Z_MEETINGS)] },
  { label: "Live captions", cells: [yes("Deepgram, your key"), yes("Translated captions", Z_FEATURES)] },
  { label: "Meeting that writes a PRD", cells: [yes(), unlisted(Z_FEATURES)] },
  { label: "Phone dial-in", cells: [no(), yes(undefined, Z_DIAL_IN)] },
  { label: "Webinars", cells: [no(), yes("Up to 100,000 attendees", Z_WEBINARS)] },
  { label: "SSO", cells: [no("Optional single email-domain limit for hosts"), yes("SAML / OIDC", Z_SSO)] },
  { label: "Who runs it", cells: [txt("You: upgrades, keys, uptime"), txt("Zoom", Z_MEETINGS)] },
];

const faq: Faq[] = [
  {
    q: "Is Quantlys Meeting fully self-hosted?",
    a: "You run the app and can run your own LiveKit media server. Captions still go to Deepgram and the PRD and notes writers to OpenAI or OpenRouter, on keys you hold, so the words do leave your servers.",
  },
  {
    q: "What do I need to self-host it?",
    a: "A Node 22+ host such as Vercel, plus LiveKit (Cloud or your own server), Supabase, S3-compatible storage, Deepgram and an OpenAI or OpenRouter key. Resend is optional for email. The quickstart is in the README.",
  },
  {
    q: "Does recording work on a bare LiveKit server?",
    a: "Not out of the box. The self-host guide lists the extra pieces a single livekit-server binary does not include, so read docs/SELF_HOST.md before relying on recording.",
  },
  {
    q: "Is it a full replacement for Zoom?",
    a: "No. It has no phone dial-in, webinars, room systems, native apps or SSO. It is built for small working sessions, especially spec meetings that should end in a PRD.",
  },
  {
    q: "What does it cost?",
    a: "The code is free under the MIT license. You pay LiveKit, Deepgram, Supabase, your storage provider and your model provider directly at their prices.",
  },
];

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description} ld={{ author: { "@id": PERSON_ID } }}>
      <CompareJsonLd path={path} items={faq} />
      <section className="qml-hero">
        <p className="qml-kicker">MIT · your keys · your servers</p>
        <h1>Self-hosted Zoom alternative</h1>
        <p className="qml-lede">
          Quantlys Meeting is my MIT-licensed side project: browser video
          meetings you can run on your own keys and infrastructure. It
          won&apos;t replace all of Zoom. It covers small working sessions, and
          the recorded spec session writes a markdown PRD.
        </p>
        <div className="qml-cta">
          <a className="qml-btn qml-btn-primary" href={REPO}>
            Source on GitHub
          </a>
          <a className="qml-btn qml-btn-ghost" href={SELF_HOST_DOC}>
            Self-host guide
          </a>
        </div>
      </section>

      <article className="qml-legal">
        <h2>What you run, and what still leaves</h2>
        <ul>
          <li><strong>The app:</strong> a Next.js app on Vercel or any Node 22+ host.</li>
          <li><strong>Media:</strong> LiveKit Cloud, or your own <code>livekit-server</code> so audio and video stay off LiveKit Cloud.</li>
          <li><strong>Data:</strong> Supabase for host sign-in, meeting history and row-level security, plus an S3-compatible bucket (R2, S3, MinIO).</li>
          <li><strong>Captions:</strong> Deepgram, on your key. Speech goes to Deepgram.</li>
          <li><strong>Writers:</strong> OpenAI or OpenRouter, on your key, for notes, the PRD and Memory mode. Transcripts go to that provider.</li>
          <li><strong>Email (optional):</strong> Resend for invites, digests and emailing the spec.</li>
        </ul>
        <p>
          So self-hosting the media server keeps media on your servers, but not
          the words. The <a href={SELF_HOST_DOC}>self-host guide</a> says the
          same thing, and lists what a bare SFU doesn&apos;t include, like
          recording egress.
        </p>

        <h2>What Zoom does better</h2>
        <ul>
          <li><strong>Reliability at scale,</strong> including webinars for up to 100,000 attendees.</li>
          <li><strong>Phone dial-in,</strong> room systems, and desktop and mobile apps.</li>
          <li><strong>Enterprise admin</strong> with SAML and OIDC SSO.</li>
          <li><strong>Nothing to operate.</strong> With Quantlys Meeting, upgrades, keys and uptime are your job.</li>
        </ul>
        <p>
          If you want a general-purpose self-hosted meeting server, also look
          at <a href="https://jitsi.org/jitsi-meet/">Jitsi Meet</a> and{" "}
          <a href="https://bigbluebutton.org/">BigBlueButton</a>. My older{" "}
          <Link href="/open-source-zoom-alternative">open-source Zoom alternative</Link>{" "}
          page compares them.
        </p>

        <h2>Side by side</h2>
        <HowWeCompared vendors="Zoom" />
        <CompareTable columns={["Quantlys Meeting (self-hosted)", "Zoom"]} rows={rows} />

        <h2>Ten-minute local start</h2>
        <p>
          <code>git clone</code> the repo, copy <code>.env.example</code> to{" "}
          <code>.env.local</code>, fill in your keys, run the Supabase schema,
          then <code>npm install</code> and <code>npm run dev</code>. Open{" "}
          <code>/host</code>, start a meeting and open the guest link in a
          second tab. The full checklist is on{" "}
          <Link href="/self-hosted-video-conferencing">self-hosted video conferencing</Link>.
        </p>

        <FaqSection items={faq} />
        <SeeAlso />
        <TrademarkNote names="Zoom, Otter, Granola and Fireflies" />
      </article>
    </IntentShell>
  );
}
