import type { Metadata } from "next";
import HomeLanding from "./HomeLanding";

const title = "Quantlys Meeting | Leave the call with a spec, not notes";
const description =
  "Open-source browser video meetings. Guests need a link. Sessions write a markdown PRD — plus Memory mode for podcasts, books, and oral history. MIT, BYO keys.";

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
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.quantlys.ai/#org",
      name: "Agility Business Services dba Quantlys",
      url: "https://www.quantlys.ai",
      sameAs: [
        "https://x.com/SantoshAdari1",
        "https://www.linkedin.com/in/santoshadari/",
      ],
      founder: {
        "@type": "Person",
        "@id": "https://santoshadari.com/#person",
        name: "Santosh Adari",
        url: "https://santoshadari.com/",
      },
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
      operatingSystem: "Web",
      license: "https://github.com/SantoshA1/quantlys-meet/blob/main/LICENSE",
      codeRepository: "https://github.com/SantoshA1/quantlys-meet",
      brand: { "@id": "https://www.quantlys.ai/#org" },
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
      <HomeLanding />
    </>
  );
}
