import type { Metadata } from "next";
import Link from "next/link";

const title = "PRD from a meeting | Quantlys Meeting";
const description =
  "How a video meeting becomes a shippable markdown PRD: host, record, project name, Build the PRD. Specimen labeled — not a customer recording.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/prd-from-meeting",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/prd-from-meeting",
    siteName: "Quantlys Meeting",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Quantlys Meeting — leave the call with a spec, not notes",
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
  url: "https://quantlys-meeting.com/prd-from-meeting",
  description,
  isPartOf: {
    "@type": "WebSite",
    name: "Quantlys Meeting",
    url: "https://quantlys-meeting.com",
  },
  mainEntity: {
    "@type": "HowTo",
    name: "Get a PRD from a Quantlys Meeting",
    description:
      "Host a browser video meeting, record with captions, name a project, then build one markdown PRD from every recorded session.",
    step: [
      {
        "@type": "HowToStep",
        name: "Host",
        text: "Sign in with an email code. Share a link. Guests join with a name — no account.",
      },
      {
        "@type": "HowToStep",
        name: "Record",
        text: "Tick recording. Everyone sees a red badge. Keep captions on so decisions land while you talk.",
      },
      {
        "@type": "HowToStep",
        name: "Build the PRD",
        text: "Put a project name on the meeting. In the host console, Build the PRD from every recording on that project. Download markdown.",
      },
    ],
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

export default function PrdFromMeetingPage() {
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
        <p className="qml-kicker">Video meeting → product spec</p>
        <h1>PRD from a meeting</h1>
        <p className="qml-lede">
          Not paste-a-transcript-into-a-generator. Quantlys Meeting is the
          video room. The recorded sessions on a project write one markdown
          PRD you can ship.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            Specimen PRD
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>01 · Host</h2>
        <p>
          Sign in with an email code. Guests join from any browser with a
          name — waiting room, lock, screen share, whiteboard, captions.
          Nothing to download.
        </p>

        <h2>02 · Record</h2>
        <p>
          Tick recording. Everyone sees a red badge. Captions on, and
          decisions, commitments, and action items land while you talk.
          Off-record is a choice, not a buried setting.
        </p>

        <h2>03 · Build the PRD</h2>
        <p>
          Put a project name on the meeting. Every recorded session on that
          project is read together. Host console: Build the PRD. Download{" "}
          <code>.md</code>. Paste it where you ship.
        </p>

        <h2>What the artifact looks like</h2>
        <p>
          Problem, user stories, acceptance criteria, decisions caught with
          who said them, non-goals, and open questions. Read a labeled
          specimen — not a customer recording — at{" "}
          <Link href="/example-prd">Example PRD</Link>. Compare that to a
          transcript or AI notes page at{" "}
          <Link href="/notes-vs-prd">Notes vs a PRD</Link>.
        </p>

        <h2>Who this is for</h2>
        <p>
          Founder-PMs and product teams who already run Zoom (or Meet) plus a
          notetaker, and still spend the next two hours turning the call into
          a spec. Use Quantlys when the output should be a PRD — coexistence,
          not a Zoom replacement.
        </p>

        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link
            className="qml-btn qml-btn-ghost"
            href="/meeting-that-writes-prd"
          >
            Why the room should write the PRD
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
