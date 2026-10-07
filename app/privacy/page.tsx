import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — Quantlys Meeting",
  description:
    "How Quantlys Meeting uses meeting audio, recordings, captions, notes, and host email. Operated by Agility Business Services / Quantlys.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/privacy",
  },
  openGraph: {
    title: "Privacy — Quantlys Meeting",
    description:
      "Who operates Quantlys Meeting, what we keep from a call, and how hosts can delete recordings.",
    url: "https://quantlys-meeting.com/privacy",
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
};

export default function PrivacyPage() {
  return (
    <div className="qml">
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
        <p className="qml-kicker">Privacy</p>
        <h1>How Quantlys Meeting uses your data</h1>
        <p className="qml-lede">Last updated 29 August 2026.</p>
      </section>

      <article className="qml-legal">
        <h2>Who operates it</h2>
        <p>
          Quantlys Meeting is operated by Agility Business Services, doing
          business as Quantlys. The hosted product is at{" "}
          <a href="https://quantlys-meeting.com">quantlys-meeting.com</a>. The
          parent site is{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a>.
        </p>

        <h2>What this product does</h2>
        <p>
          Quantlys Meeting is video in a browser tab. Hosts can record a
          session. When recording is on, everyone in the room sees a recording
          badge. Captions and a transcript can run during the call. From
          recorded meetings we write notes, catch decisions, and can build a
          PRD — problem, user stories, acceptance criteria, decisions, and open
          questions — for the host&apos;s project.
        </p>

        <h2>Guests and hosts</h2>
        <p>
          Guests join with a meeting link or code. They do not create an
          account. They type a display name and use camera and microphone as
          needed for the call.
        </p>
        <p>
          Hosts sign in with an email one-time code at{" "}
          <Link href="/host">/host</Link>. We keep that email as the host
          account. After a recorded meeting we may email notes to the host. We
          may also send a weekly digest of what is still open.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>Host email, for sign-in, notes mail, and the digest.</li>
          <li>
            Meeting details the host sets: title, project name, schedule.
          </li>
          <li>Guest display names while they are in the room.</li>
          <li>
            If the host records: audio and video, captions and transcript,
            notes, decisions, action items, and any PRD built from those
            meetings.
          </li>
          <li>
            A sign-in session for hosts, and a theme preference on the device.
          </li>
        </ul>
        <p>
          We use meeting audio and transcripts to run captions, notes, and the
          PRD for that host.
        </p>

        <h2>Cookies and the session</h2>
        <p>
          The product needs a browser session to run the call — to connect
          audio and video, and to keep a host signed in. Hosts get a sign-in
          session after the email code. We store a theme preference in local
          storage on your device. We do not use advertising cookies.
        </p>

        <h2>Infrastructure</h2>
        <p>
          To run the hosted product we use other companies for realtime video,
          speech-to-text, database and file storage, application hosting, email
          delivery, and language-model processing for notes and PRDs. Audio,
          video, transcripts, and notes pass through those systems so the
          features work. We do not name those vendors on this page.
        </p>

        <h2>How long we keep it</h2>
        <p>
          We keep recordings, transcripts, notes, action items, and PRDs while
          the host account exists. From the host page, a host can delete a
          recording, and can delete a meeting — which removes that meeting&apos;s
          recordings and notes. Completed action items may be pruned after a
          year. Recordings may also be removed after a retention window we
          configure for the hosted service.
        </p>

        <h2>Children</h2>
        <p>
          Quantlys Meeting is not directed at children under 13. Do not use it
          if you are under 13.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes, we will update this page and the date at the
          top.
        </p>

        <h2>Contact</h2>
        <p>
          There is no separate public privacy inbox in the product. Contact us
          through the host sign-in email channel — the address you use at{" "}
          <Link href="/host">/host</Link> — or the site operator, Quantlys /
          Agility Business Services, via{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a> or{" "}
          <a href="https://quantlys-meeting.com">this site</a>.
        </p>
      </article>

      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai">quantlys.ai</a>
        </span>
        <span>
          <Link href="/">Home</Link>
          <Link href="/host">Host</Link>
          <Link href="/open-source-video-meeting">Open source</Link>
          <Link href="/memory-mode">Memory</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
