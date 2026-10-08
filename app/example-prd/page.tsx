import type { Metadata } from "next";
import Link from "next/link";

const title = "Example PRD from a spec meeting | Quantlys Meeting";
const description =
  "Labeled specimen of the markdown PRD Quantlys Meeting writes from recorded meetings. Not a customer recording.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/example-prd",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/example-prd",
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
  url: "https://quantlys-meeting.com/example-prd",
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

export default function ExamplePrdPage() {
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
        <p className="qml-kicker">
          Example PRD · specimen, not a customer recording
        </p>
        <h1>Example PRD from a spec meeting</h1>
        <p className="qml-lede">
          Labeled specimen of the markdown PRD Quantlys Meeting writes from
          recorded meetings. Project billing-v2 · 3 recorded meetings. Not a
          customer recording.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/recap-vs-prd">
            Recap vs a PRD
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/notes-vs-prd">
            Notes vs a PRD
          </Link>
        </div>
      </section>

      <section className="qml-block">
        <article className="qml-prd">
          <div className="qml-prd-bar">
            <i />
            Example PRD · specimen, not a customer recording
          </div>
          <div className="qml-prd-body">
            <span className="qml-chip">Project: billing-v2</span>
            <span className="qml-chip">3 recorded meetings</span>
            <h3>PRD · Self-serve plan change</h3>
            <h4>Problem</h4>
            <p>
              Workspace admins email support to change plans. Finance cannot
              see proration before the change lands. Two of three working
              sessions named this as the reason upgrades stall.
            </p>
            <h4>User stories</h4>
            <ul>
              <li>
                As an admin, I can preview the next invoice before I confirm a
                plan change.
              </li>
              <li>
                As finance, I can see who changed a plan and the proration that
                applied.
              </li>
              <li>
                As an admin, I can downgrade without talking to support, with a
                clear effective date.
              </li>
            </ul>
            <h4>Acceptance criteria</h4>
            <ul>
              <li>Preview matches the invoice generated within $0.01.</li>
              <li>
                Downgrades take effect at period end unless the admin opts into
                immediate.
              </li>
              <li>
                Every plan change writes an audit row: actor, from-plan,
                to-plan, proration, timestamp.
              </li>
              <li>
                Free → Pro and Pro → Max work in one confirmation. Max → Free
                is blocked and routes to support.
              </li>
            </ul>
            <h4>Decisions</h4>
            <div className="qml-caught">
              Decision caught · Maya: “We will not prorate downgrades
              mid-cycle.” · 18:14
            </div>
            <div className="qml-caught">
              Decision caught · Jules: “Preview is a hard gate. No confirm
              button until the number is on screen.” · 22:03
            </div>
            <p>
              Conflict · Maya said no mid-cycle downgrade proration. Raj wanted
              immediate credit. Parking lot: revisit only if churn from that
              rule shows up in billing-v2 week 4.
            </p>
            <h4>Non-goals</h4>
            <ul>
              <li>No annual-contract self-serve in this pass.</li>
              <li>No seat-level plans.</li>
              <li>No sales-assisted quotes inside this flow.</li>
            </ul>
            <h4>Open</h4>
            <ul>
              <li>
                Tax on proration for EU VAT — parked. Jules to confirm with
                counsel.
              </li>
              <li>
                Whether failed payments on upgrade roll back the plan or keep
                Pro and retry — needs finance.
              </li>
            </ul>
          </div>
        </article>
      </section>

      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai/">quantlys.ai</a>
        </span>
        <span>
          <Link href="/">Home</Link>
          <Link href="/host">Host</Link>
          <Link href="/meeting-that-writes-prd">Meeting → PRD</Link>
          <Link href="/prd-from-meeting">PRD from meeting</Link>
          <Link href="/notes-vs-prd">Notes vs PRD</Link>
          <Link href="/recap-vs-prd">Recap vs a PRD</Link>
          <Link href="/open-source-video-meeting">Open source</Link>
          <Link href="/memory-mode">Memory</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
