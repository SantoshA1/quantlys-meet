import type { Metadata } from "next";
import Link from "next/link";

const title = "Memory mode for podcasts and oral history | Quantlys Meeting";
const description =
  "Record podcasts, books, and oral history in the browser. Memory hands back the full episode as one continuous HD 720p video (MP4 or WebM), captions (.vtt / .srt), audio clips, and a markdown story or manuscript outline.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/memory-mode",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/memory-mode",
    siteName: "Quantlys Meeting",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Quantlys Meeting — Memory mode for podcasts and oral history",
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
  url: "https://quantlys-meeting.com/memory-mode",
  description,
  isPartOf: {
    "@type": "WebSite",
    name: "Quantlys Meeting",
    url: "https://quantlys-meeting.com",
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

export default function MemoryModePage() {
  return (
    <div className="qml">
      <JsonLd />
      <nav className="qml-nav">
        <Link href="/">Home</Link>
        <Link href="/open-source-video-meeting">Open source</Link>
        <Link href="/#join">Join</Link>
        <span className="qml-nav-spacer" />
        <Link className="qml-btn qml-btn-primary qml-nav-host" href="/host">
          Open host console
        </Link>
      </nav>

      <section className="qml-hero">
        <p className="qml-kicker">Podcasts · books · legacy stories</p>
        <h1>Memory mode for podcasts and oral history</h1>
        <p className="qml-lede">
          Same browser video stack as Quantlys Meeting — different intent than
          a sync product review. Launch Memory from the host console, record
          with captions, then take home the full episode as one continuous
          HD 720p video, captions, audio clips, and a story or manuscript{" "}
          <code>.md</code>.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Start in host console
          </Link>
          <Link
            className="qml-btn qml-btn-ghost"
            href="/open-source-video-meeting"
          >
            Self-host / open source
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>Podcast recording with chapters and clips</h2>
        <p>
          Treat a series of Memory sessions as episodes. Reorder them, generate
          chapter headings from the transcript, and export audio clips for
          show notes or social cuts. Each episode is also one continuous HD 720p
          video (MP4 or WebM) with <code>.vtt</code> / <code>.srt</code>{" "}
          captions. Timed chapter/quote cuts download as <strong>WAV</strong>{" "}
          when mm:ss cues or timed captions exist. Captions stay on so the
          words you said drive the outline.
        </p>

        <h2>Oral history and legacy stories</h2>
        <p>
          Sit with a parent, elder, or teammate and record the conversation.
          Memory packages the sessions into a shareable story artifact:
          summary, chapters, quotes, open threads. Guests still join from a
          link; only the host signs in.
        </p>

        <h2>Write a book from conversations</h2>
        <p>
          Pick the book intent when you build Memory. Multiple recorded
          sessions on a project roll into a manuscript-style outline —
          headings, evidence from the room, open threads to chase next. It is
          a working draft from talk, not a finished novel. You still edit.
        </p>

        <h2>What you take home</h2>
        <p>
          A transcript alone is not an episode. Every Memory chapter in the
          host console downloads as:
        </p>
        <ul>
          <li>
            <strong>Full video</strong> — one continuous take at 1280×720,
            24fps (HD 720p): <strong>MP4</strong> in Chrome, Edge, and Safari,{" "}
            <strong>WebM</strong> in Firefox.
            Not stitched segments, not transcript-only — remote guests are
            recorded from their camera feed (up to 720p, what their camera and
            connection deliver).
          </li>
          <li>
            <strong>Captions</strong> — <code>.vtt</code> or <code>.srt</code>{" "}
            from the timed transcript, ready for YouTube, Descript, or Premiere.
          </li>
          <li>
            <strong>Audio</strong> — the full episode as <strong>m4a</strong>{" "}
            (or <strong>audio.webm</strong>), plus <strong>WAV</strong>{" "}
            chapter / quote cuts when mm:ss cues exist.
          </li>
          <li>
            <strong>Markdown package</strong> — story or manuscript{" "}
            <code>.md</code> (summary, chapters, quotes, open threads), or a
            shareable link.
          </li>
        </ul>
        <p>
          Recording, captions, and the package run on our cloud at
          quantlys-meeting.com, or on your keys when you self-host. Big takes
          upload resumably. If storage ever refuses a file that size, the
          full-resolution take still downloads straight from your browser tab
          before you leave. No MOV: we only list files the recorder actually
          writes. Dogfood from Quantlys.
        </p>

        <h2>How it fits next to Meeting → PRD</h2>
        <p>
          Spec meetings write a markdown PRD for product work (
          <Link href="/meeting-that-writes-prd">meeting that writes a PRD</Link>
          ). Memory mode is the second surface: podcasts, books, oral history.
          Same LiveKit / Deepgram / Supabase / model keys. Hosted at{" "}
          <Link href="/">quantlys-meeting.com</Link>; source on{" "}
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>{" "}
          (MIT, v1.0.0-oss). Dogfood for{" "}
          <a href="https://www.quantlys.ai/">quantlys.ai</a> by Santosh Adari.
        </p>

        <p>
          Recording a remote show? The step-by-step is on{" "}
          <Link href="/podcast-recording-in-browser">podcast recording in the browser</Link>,
          including when a local multi-track recorder is the better tool.
        </p>

        <h2>What you need</h2>
        <ul>
          <li>Host account (email code) — guests need a link only</li>
          <li>Recording + captions on for usable chapters and clip cuts</li>
          <li>A project name so sessions group together</li>
          <li>
            Optional: self-host with your own keys —{" "}
            <Link href="/open-source-video-meeting">open-source video meeting</Link>
          </li>
        </ul>

        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Open host console
          </Link>
          <a
            className="qml-btn qml-btn-ghost"
            href="https://github.com/SantoshA1/quantlys-meet"
          >
            Source on GitHub
          </a>
        </div>
      </article>

      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai/">quantlys.ai</a>
        </span>
        <span>
          <Link href="/">Home</Link>
          <Link href="/open-source-video-meeting">Open source</Link>
          <Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
          <Link href="/prd-from-meeting">PRD from meeting</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
