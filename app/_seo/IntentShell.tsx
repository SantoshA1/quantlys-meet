import type { Metadata } from "next";
import Link from "next/link";

// Shared chrome for the short search-intent pages (one query, one job each).
// Keeping nav/footer/JSON-LD in one place means every intent page links to
// every other one and to home — the internal-link graph is not something each
// page has to remember to maintain.

export const SITE = "https://quantlys-meeting.com";

export const INTENT_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/browser-video-meeting-no-download", label: "No-download meetings" },
  { href: "/open-source-zoom-alternative", label: "Open-source Zoom alternative" },
  { href: "/self-hosted-video-conferencing", label: "Self-hosted video conferencing" },
  { href: "/open-source-video-meeting", label: "Open-source video conferencing" },
  { href: "/podcast-recording-in-browser", label: "Podcast recording in browser" },
  { href: "/memory-mode", label: "Memory mode" },
  { href: "/ai-meeting-assistant-prd", label: "AI meeting assistant → PRD" },
  { href: "/meeting-that-writes-prd", label: "Meeting → PRD" },
  { href: "/prd-from-meeting", label: "PRD from meeting" },
  { href: "/notes-vs-prd", label: "Notes vs PRD" },
  { href: "/recap-vs-prd", label: "Recap vs PRD" },
  { href: "/example-prd", label: "Example PRD" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
];

export function intentMetadata(path: string, title: string, description: string, ogAlt: string): Metadata {
  const url = `${SITE}${path}`;
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "Quantlys Meeting",
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: ogAlt }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export function IntentShell({
  path,
  title,
  description,
  children,
}: {
  path: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: `${SITE}${path}`,
    description,
    isPartOf: { "@id": `${SITE}/#website` },
    about: { "@id": `${SITE}/#app` },
    publisher: { "@id": "https://www.quantlys.ai/#org" },
  };
  return (
    <div className="qml">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <nav className="qml-nav">
        <Link href="/">Home</Link>
        <Link href="/open-source-zoom-alternative">Open source</Link>
        <Link href="/memory-mode">Memory</Link>
        <span className="qml-nav-spacer" />
        <Link className="qml-btn qml-btn-primary qml-nav-host" href="/host">
          Host a meeting
        </Link>
      </nav>
      {children}
      <footer className="qml-foot">
        <span>
          © Quantlys · Agility Business Services ·{" "}
          <a href="https://www.quantlys.ai/platform">Built on Quantlys</a> · Built by{" "}
          <a href="https://santoshadari.com/">Santosh Adari</a>
        </span>
        <span>
          {INTENT_LINKS.filter((l) => l.href !== path).map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <a href="https://github.com/SantoshA1/quantlys-meet">GitHub</a>
        </span>
      </footer>
    </div>
  );
}
