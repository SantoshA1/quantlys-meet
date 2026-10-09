import type { Metadata } from "next";
import Home from "./_home/B";

const title = "Video Meeting App That Writes Your PRD | Quantlys Meeting";
const description =
  "Open-source video conferencing in your browser. Guests join from a link, no download. Recorded sessions write a markdown PRD, not a transcript. MIT.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://quantlys-meeting.com/",
  },
  openGraph: {
    title,
    description,
    url: "https://quantlys-meeting.com/",
    siteName: "Quantlys Meeting",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Quantlys Meeting — the video meeting app that writes your PRD",
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
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.quantlys.ai/#org",
      name: "Quantlys",
      legalName: "Agility Business Services, Inc.",
      alternateName: ["Quantlys AI", "Agility Business Services dba Quantlys"],
      url: "https://www.quantlys.ai/",
      sameAs: [
        "https://www.agilityserv.com/",
        "https://medium.com/quantlys",
        "https://github.com/Agility-Business-Services",
      ],
      founder: { "@id": "https://santoshadari.com/#person" },
    },
    {
      "@type": "Person",
      "@id": "https://santoshadari.com/#person",
      name: "Santosh Adari",
      url: "https://santoshadari.com/",
      jobTitle: "Founder, Quantlys",
      sameAs: [
        "https://www.linkedin.com/in/santoshadari",
        "https://x.com/SantoshAdari1",
        "https://github.com/SantoshA1",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://quantlys-meeting.com/#website",
      name: "Quantlys Meeting",
      url: "https://quantlys-meeting.com/",
      publisher: { "@id": "https://www.quantlys.ai/#org" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://quantlys-meeting.com/#app",
      name: "Quantlys Meeting",
      url: "https://quantlys-meeting.com/",
      description:
        "Open-source browser video room whose recorded session writes a markdown PRD, plus Memory mode for podcasts and oral history. Not Quantalys, the fund-data company.",
      applicationCategory: "CommunicationApplication",
      applicationSubCategory: "Video conferencing",
      operatingSystem: "Web",
      browserRequirements: "Requires a WebRTC-capable browser (Chrome, Edge, Firefox, Safari).",
      featureList: [
        "Browser video meetings — guests join from a link, no download or account",
        "Waiting room, room lock, screen share, whiteboard, live captions",
        "HD 720p recording (MP4 or WebM)",
        "Recorded sessions write a markdown PRD",
        "Memory mode for podcasts, books, and oral history",
        "MIT-licensed, self-hostable",
      ],
      license: "https://github.com/SantoshA1/quantlys-meet/blob/main/LICENSE",
      codeRepository: "https://github.com/SantoshA1/quantlys-meet",
      brand: { "@id": "https://www.quantlys.ai/#org" },
      creator: { "@id": "https://santoshadari.com/#person" },
      sameAs: ["https://github.com/SantoshA1/quantlys-meet"],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
    {
      "@type": "FAQPage",
      "@id": "https://quantlys-meeting.com/#faq",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is Quantlys Meeting?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A browser video meeting. Guests join from a link. The recorded session writes a markdown PRD: user stories, acceptance criteria, decisions, and open questions.",
          },
        },
        {
          "@type": "Question",
          name: "Is Quantlys Meeting the same as Quantalys?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Quantlys Meeting is a spec-session video product at quantlys-meeting.com. Quantalys is an unrelated fund-data company.",
          },
        },
        {
          "@type": "Question",
          name: "Does Quantlys Meeting write a PRD from the meeting?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Recorded sessions on a project roll into one markdown PRD: problem, user stories, acceptance criteria, decisions, and open questions. It is not a transcript or AI notes page.",
          },
        },
        {
          "@type": "Question",
          name: "Is Quantlys Meeting open source?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. MIT-licensed at github.com/SantoshA1/quantlys-meet. Bring your own LiveKit, Deepgram, Supabase, OpenAI or OpenRouter, and S3 keys.",
          },
        },
        {
          "@type": "Question",
          name: "What is Memory mode?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A host-console surface for podcasts (chapters and clips), books, and oral history — separate from the product-review PRD path.",
          },
        },
      ],
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
      <Home />
    </>
  );
}
