import type { Metadata } from "next";
import Link from "next/link";

const title = "Meeting notes vs a PRD | Quantlys Meeting";
const description =
  "Transcripts and AI meeting notes summarize. A PRD is shippable: problem, stories, acceptance criteria, decisions. Quantlys writes the PRD from the room.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/notes-vs-prd",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/notes-vs-prd",
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
  url: "https://quantlys-meeting.com/notes-vs-prd",
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

export default function NotesVsPrdPage() {
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
        <p className="qml-kicker">Transcript / notes vs the artifact</p>
        <h1>Meeting notes are not a PRD</h1>
        <p className="qml-lede">
          A transcript is what was said. AI notes are a summary. A PRD is what
          engineering builds from: problem, user stories, acceptance criteria,
          decisions, and open questions. Quantlys Meeting is a video room
          whose default output is that PRD — not another notes page.
        </p>
      </section>

      <article className="qml-legal">
        <h2>Transcript</h2>
        <p>
          Full text of the call. Useful for search and quotes. You still
          structure scope, AC, and trade-offs by hand — or paste into another
          tool after the meeting ends.
        </p>

        <h2>AI meeting notes</h2>
        <p>
          Notetakers summarize speakers, action items, and highlights. They
          help you remember the call. They do not leave you with a shippable
          product requirements document unless you rewrite them into one.
        </p>

        <h2>PRD from the room</h2>
        <p>
          Quantlys Meeting hosts the video. When you record with captions on,
          sessions on a project roll into one markdown PRD. Decisions are
          caught as they are said. You download <code>.md</code> and paste
          where you ship. See also{" "}
          <Link href="/recap-vs-prd">Zoom recap vs a PRD</Link> for recap
          tools, and a labeled specimen at{" "}
          <Link href="/example-prd">Example PRD</Link>.
        </p>

        <h2>Side-by-side</h2>
        <ul>
          <li>
            <strong>Transcript</strong> — words. No acceptance criteria unless
            someone typed them.
          </li>
          <li>
            <strong>Notes / recap</strong> — summary. Still a rewrite before
            engineering.
          </li>
          <li>
            <strong>Quantlys PRD</strong> — structured artifact from the
            recorded room. Specimen labeled; not a customer recording.
          </li>
        </ul>

        <h2>Lead with the artifact</h2>
        <p>
          This is not positioned as a Zoom killer or another AI-notes app. Use
          it when the call&apos;s job is a product spec. Read why at{" "}
          <Link href="/meeting-that-writes-prd">
            Meeting that writes a PRD
          </Link>{" "}
          and the how at <Link href="/prd-from-meeting">PRD from a meeting</Link>.
        </p>

        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            Read the specimen
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
          <Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
          <Link href="/prd-from-meeting">PRD from meeting</Link>
          <Link href="/recap-vs-prd">Recap vs PRD</Link>
          <Link href="/open-source-video-meeting">Open source</Link>
          <Link href="/memory-mode">Memory</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
