import type { Metadata } from "next";
import Link from "next/link";

const title = "Zoom recap vs a PRD | Quantlys Meeting";
const description =
  "Recap tools (Zoom Companion, Granola, Otter, Fireflies) summarize. Quantlys Meeting is a browser video room whose recorded session writes a markdown PRD.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/recap-vs-prd",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/recap-vs-prd",
    siteName: "Quantlys Meeting",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Quantlys Meeting",
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
  url: "https://quantlys-meeting.com/recap-vs-prd",
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

export default function RecapVsPrdPage() {
  return (
    <div className="qml">
      <JsonLd />
      <nav className="qml-nav">
        <Link href="/">Home</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/#join">Join</Link>
        <span className="qml-nav-spacer" />
        <Link className="qml-btn qml-btn-primary qml-nav-host" href="/host">
          Host a meeting
        </Link>
      </nav>

      <section className="qml-hero">
        <p className="qml-kicker">Recap vs a PRD</p>
        <h1>A recap is notes. A PRD is the minutes.</h1>
        <p className="qml-lede">
          Recap tools summarize the call. Quantlys Meeting is a browser video
          room whose recorded session writes a markdown PRD: problem, user
          stories, acceptance criteria, decisions, and open questions.
        </p>
      </section>

      <article className="qml-legal">
        <h2>What a recap is</h2>
        <p>
          Zoom Companion, Granola, Otter, and Fireflies recap what people said.
          Granola enhances the notes you already take. Fireflies can run a
          skill after the meeting that drafts a product spec. They do that job
          well. A recap is still notes — a summary you turn into a spec later.
        </p>

        <h2>What a spec meeting writes</h2>
        <p>
          Quantlys Meeting is video in a browser tab. Guests need a link, not
          an account. When the host records, the working session writes a
          markdown PRD. The room&apos;s default artifact is the spec, not a
          recap you prompt into one. Read a labeled specimen — not a customer
          recording — at{" "}
          <Link href="/example-prd">Example PRD</Link>.
        </p>

        <h2>Host a spec session</h2>
        <p>
          Host a meeting. Record. Build the PRD from the sessions on that
          project. Download markdown and paste it where you ship.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            Read an example PRD
          </Link>
        </div>
      </article>

      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai/">quantlys.ai</a>
        </span>
        <span>
          <Link href="/">Home</Link>
          <Link href="/host">Host</Link>
          <Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
          <Link href="/notes-vs-prd">Notes vs PRD</Link>
          <Link href="/example-prd">Example PRD</Link>
          <Link href="/open-source-video-meeting">Open source</Link>
          <Link href="/memory-mode">Memory</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
