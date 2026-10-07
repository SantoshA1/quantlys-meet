import type { Metadata } from "next";
import Link from "next/link";

const title = "Open-Source Video Conferencing Software | Quantlys Meeting";
const description =
  "MIT open-source video conferencing software for the browser. Self-host with LiveKit, Deepgram, Supabase, OpenAI. Writes a PRD — plus Memory mode.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/open-source-video-meeting",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/open-source-video-meeting",
    siteName: "Quantlys Meeting",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Quantlys Meeting — open-source video conferencing software",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: title,
  url: "https://quantlys-meeting.com/open-source-video-meeting",
  description,
  isPartOf: {
    "@type": "WebSite",
    name: "Quantlys Meeting",
    url: "https://quantlys-meeting.com",
  },
  about: {
    "@type": "SoftwareApplication",
    name: "Quantlys Meeting",
    applicationCategory: "CommunicationApplication",
    operatingSystem: "Web",
    license: "https://github.com/SantoshA1/quantlys-meet/blob/main/LICENSE",
    codeRepository: "https://github.com/SantoshA1/quantlys-meet",
    url: "https://quantlys-meeting.com/",
  },
};

function JsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export default function OpenSourceVideoMeetingPage() {
  return (
    <div className="qml">
      <JsonLd />
      <nav className="qml-nav">
        <Link href="/">Home</Link>
        <Link href="/memory-mode">Memory mode</Link>
        <Link href="/#own">Self-host</Link>
        <span className="qml-nav-spacer" />
        <a
          className="qml-btn qml-btn-primary qml-nav-host"
          href="https://github.com/SantoshA1/quantlys-meet"
        >
          GitHub
        </a>
      </nav>

      <section className="qml-hero">
        <p className="qml-kicker">MIT · plug your own keys</p>
        <h1>Open-source video conferencing software</h1>
        <p className="qml-lede">
          Quantlys Meeting is MIT-licensed video conferencing software you run
          in the browser with your own keys. Guests join from a link. Recorded
          sessions can write a markdown PRD. Memory mode covers podcasts, books,
          and oral history. Not a locked SaaS notetaker — source is public.
        </p>
        <div className="qml-cta">
          <a
            className="qml-btn qml-btn-primary"
            href="https://github.com/SantoshA1/quantlys-meet"
          >
            Clone on GitHub
          </a>
          <a
            className="qml-btn qml-btn-ghost"
            href="https://github.com/SantoshA1/quantlys-meet/releases/tag/v1.0.0-oss"
          >
            v1.0.0-oss release
          </a>
          <Link className="qml-btn qml-btn-ghost" href="/host">
            Try hosted
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>Self-host / white-label Zoom alternative</h2>
        <p>
          If you want meetings on keys you control — not another account
          silo — this is the path. Bring LiveKit (Cloud or your own SFU),
          Deepgram, Supabase, S3-compatible storage, and an OpenAI or
          OpenRouter key. Deploy on Vercel or any Node host that runs Next.js
          14. Guests still need only a link; the host signs in.
        </p>
        <p>
          Honest scope: this is coexistence for product reviews and Memory
          sessions, not a claim that it replaces every Zoom/Meet feature on
          day one. Recording egress on a bare <code>livekit-server</code>{" "}
          needs extra pieces — see{" "}
          <a href="https://github.com/SantoshA1/quantlys-meet/blob/main/docs/SELF_HOST.md">
            docs/SELF_HOST.md
          </a>
          .
        </p>

        <h2>BYO keys — what you plug in</h2>
        <ul>
          <li>
            <strong>LiveKit</strong> — realtime video/audio (Cloud or
            self-hosted SFU)
          </li>
          <li>
            <strong>Deepgram</strong> — live captions / transcripts
          </li>
          <li>
            <strong>Supabase</strong> — auth, meeting history, RLS
          </li>
          <li>
            <strong>OpenAI or OpenRouter</strong> — notes, PRD, Memory writers
          </li>
          <li>
            <strong>S3-compatible storage</strong> — recordings (R2, S3,
            MinIO, …)
          </li>
          <li>
            <strong>Vercel</strong> (or any Next.js host) — the app itself
          </li>
        </ul>

        <h2>~10 minutes to a local smoke path</h2>
        <p>
          <code>git clone</code> → copy <code>.env.example</code> → fill keys →{" "}
          <code>npm i</code> → <code>npm run dev</code>. Deploy-to-Vercel
          button is in the README. Full checklist in the self-host guide.
        </p>

        <h2>What the room writes</h2>
        <p>
          Spec sessions: recorded meetings on a project roll into one markdown
          PRD — problem, stories, acceptance criteria, decisions, open
          questions. See{" "}
          <Link href="/meeting-that-writes-prd">Meeting that writes a PRD</Link>{" "}
          and <Link href="/prd-from-meeting">PRD from a meeting</Link>. Memory
          mode (podcasts with chapters/clips, books, oral history — continuous
          HD 720p MP4/WebM video, .vtt/.srt captions, m4a/WAV audio, and{" "}
          <code>.md</code>) is documented at{" "}
          <Link href="/memory-mode">Memory mode</Link>.
        </p>

        <h2>Go deeper</h2>
        <p>
          Comparing options? See{" "}
          <Link href="/open-source-zoom-alternative">open-source Zoom alternative</Link>{" "}
          (vs Zoom, Jitsi Meet, BigBlueButton). Running it yourself? See{" "}
          <Link href="/self-hosted-video-conferencing">self-hosted video conferencing</Link>.
          Guests:{" "}
          <Link href="/browser-video-meeting-no-download">browser video meeting, no download</Link>.
        </p>

        <h2>Who built this</h2>
        <p>
          Santosh Adari built Quantlys Meeting as dogfood for{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a>. Live hosted
          product: <Link href="/">quantlys-meeting.com</Link>. Quantlys
          Conclave and the rest of the platform stay closed — this repo is the
          meeting app only (Conclave-compatible rubrics + paste-handoff). No
          invented customer counts.
        </p>

        <div className="qml-cta">
          <a
            className="qml-btn qml-btn-primary"
            href="https://github.com/SantoshA1/quantlys-meet"
          >
            github.com/SantoshA1/quantlys-meet
          </a>
          <Link className="qml-btn qml-btn-ghost" href="/memory-mode">
            Memory mode
          </Link>
        </div>
      </article>

      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a>
        </span>
        <span>
          <Link href="/">Home</Link>
          <Link href="/open-source-zoom-alternative">Zoom alternative</Link>
          <Link href="/self-hosted-video-conferencing">Self-hosted</Link>
          <Link href="/browser-video-meeting-no-download">No download</Link>
          <Link href="/memory-mode">Memory</Link>
          <Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
          <Link href="/prd-from-meeting">PRD from meeting</Link>
          <Link href="/notes-vs-prd">Notes vs PRD</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
