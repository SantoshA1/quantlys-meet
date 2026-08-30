import type { Metadata } from "next";
import HomeLanding from "./HomeLanding";

const description =
  "Video in a browser tab. Guests need a link, not an account. The session writes a PRD: user stories, acceptance criteria, decisions, and open questions.";

export const metadata: Metadata = {
  title: "Quantlys Meeting — leave the call with a spec, not notes",
  description,
  alternates: {
    canonical: "https://quantlys-meeting.com/",
  },
  openGraph: {
    title: "Quantlys Meeting — the meeting that writes the PRD",
    description:
      "Guests join in a tab. Hosts leave with a spec. Later, run it on your cloud with your models.",
    url: "https://quantlys-meeting.com/",
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
    title: "Quantlys Meeting — the meeting that writes the PRD",
    description: "Guests join in a tab. Hosts leave with a spec.",
    images: ["/og.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Agility Business Services dba Quantlys",
      url: "https://www.quantlys.ai",
      sameAs: [
        "https://x.com/SantoshAdari1",
        "https://www.linkedin.com/in/santoshadari/",
      ],
    },
    {
      "@type": "SoftwareApplication",
      name: "Quantlys Meeting",
      url: "https://quantlys-meeting.com",
      applicationCategory: "CommunicationApplication",
      operatingSystem: "Web",
    },
  ],
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

export default function Page() {
  return (
    <>
      <JsonLd />
      <HomeLanding />
    </>
  );
}
