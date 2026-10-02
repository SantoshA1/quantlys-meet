import type { Metadata } from "next";
import Link from "next/link";

const title = "Meeting that writes a PRD | Quantlys Meeting";
const description =
  "Product reviews still end in notes. Quantlys Meeting is a browser video room whose recorded session writes the PRD: stories, AC, decisions, open questions.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/meeting-that-writes-prd",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/meeting-that-writes-prd",
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
  url: "https://quantlys-meeting.com/meeting-that-writes-prd",
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

export default function MeetingThatWritesPrdPage() {
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
        <p className="qml-kicker">The problem</p>
        <h1>A meeting that writes a PRD</h1>
        <p className="qml-lede">
          You finish a product review. Someone dumps a transcript into a
          notetaker or ChatPRD. Two hours later you still do not have
          something an engineer can build. The gap is not better notes — it is
          that the room never produced the artifact.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            Read a specimen PRD
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>What breaks after a good call</h2>
        <p>
          Zoom and Meet recap the conversation. Granola, Otter, and Fireflies
          write notes. Transcript → PRD tools ask you to paste after the fact.
          None of those make the working session itself write problem, user
          stories, acceptance criteria, decisions, and open questions while
          people are still in the room.
        </p>

        <h2>What Quantlys Meeting does instead</h2>
        <p>
          Quantlys Meeting is video in a browser tab. Guests need a link, not
          an account. Tick recording, keep captions on, and the recorded
          sessions on a project roll into one markdown PRD you can download and
          paste into Linear, GitHub, or Conclave. The meeting is the product
          review. The PRD is the minutes.
        </p>
        <ul>
          <li>Host signs in with an email code. Guests join in one click.</li>
          <li>
            Decisions and commitments are caught as they are said — not
            reconstructed from a summary later.
          </li>
          <li>
            One project name across sessions. Build the PRD from every
            recording on that project.
          </li>
        </ul>

        <h2>Honesty about where this is</h2>
        <p>
          Early product. Hosted at{" "}
          <Link href="/">quantlys-meeting.com</Link>. Source is open at{" "}
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a> —
          plug your keys and self-host. No invented customer counts. See a
          labeled specimen (not a customer recording) at{" "}
          <Link href="/example-prd">Example PRD</Link>, how notes differ at{" "}
          <Link href="/notes-vs-prd">Notes vs a PRD</Link>, and how to get a
          PRD from the room at{" "}
          <Link href="/prd-from-meeting">PRD from a meeting</Link>.
        </p>

        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/prd-from-meeting">
            How a PRD comes from the call
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
          <Link href="/prd-from-meeting">PRD from meeting</Link>
          <Link href="/notes-vs-prd">Notes vs PRD</Link>
          <Link href="/example-prd">Example PRD</Link>
          <Link href="/privacy">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}
