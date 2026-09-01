import type { Metadata } from "next";
import HomeLanding from "./HomeLanding";

const title = "Quantlys Meeting | Leave the call with a spec, not notes";
const description =
  "Video in a browser tab. Guests need a link, not an account. The session writes a PRD: user stories, acceptance criteria, decisions, and open questions.";

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
        "Quantlys Meeting is a browser video room whose recorded session writes a markdown PRD. It is not Quantalys, the fund-data company.",
      applicationCategory: "CommunicationApplication",
      operatingSystem: "Web",
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
