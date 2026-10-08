import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";

const path = "/about";
const title = "About Quantlys Meeting: Built on Quantlys by Santosh Adari";
const description =
  "Who builds Quantlys Meeting and why: an open-source (MIT) video meeting app built by Santosh Adari as dogfood for Quantlys, the AI platform at quantlys.ai.";

export const metadata = intentMetadata(path, title, description, "About Quantlys Meeting, built on Quantlys");

const aboutLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": "https://quantlys-meeting.com/about#webpage",
      url: "https://quantlys-meeting.com/about",
      name: title,
      isPartOf: { "@id": "https://quantlys-meeting.com/#website" },
      about: { "@id": "https://quantlys-meeting.com/#app" },
      mainEntity: { "@id": "https://www.quantlys.ai/#org" },
      dateModified: "2026-10-08",
    },
    {
      "@type": "Organization",
      "@id": "https://www.quantlys.ai/#org",
      name: "Quantlys",
      legalName: "Agility Business Services, Inc.",
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
  ],
};

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutLd).replace(/</g, "\\u003c") }}
      />
      <section className="qml-hero">
        <p className="qml-kicker">About · Built on Quantlys</p>
        <h1>About Quantlys Meeting</h1>
        <p className="qml-lede">
          Quantlys Meeting is a browser video meeting app whose recorded
          session writes a markdown PRD. It is built by{" "}
          <a href="https://santoshadari.com/">Santosh Adari</a> as dogfood
          for <a href="https://www.quantlys.ai/platform">Quantlys</a>, the AI
          platform that designs and builds web, iOS, and Android apps. The
          meeting app is open source under MIT.
        </p>
        <div className="qml-cta">
          <a className="qml-btn qml-btn-primary" href="https://www.quantlys.ai/platform">
            What is Quantlys?
          </a>
          <a className="qml-btn qml-btn-ghost" href="https://github.com/SantoshA1/quantlys-meet">
            Source on GitHub
          </a>
        </div>
      </section>

      <article className="qml-legal">
        <h2>Why a meeting app</h2>
        <p>
          Quantlys starts from a written spec. The Conclave, five frontier
          models on the Quantlys platform, drafts, peer-ranks, and synthesizes
          a plan from it, and an agent crew builds the app. In practice, most
          specs start as a conversation, and the notes from that conversation
          are not a spec. Quantlys Meeting closes that gap: hold the session
          here, and the recorded meeting rolls into a PRD you can paste into
          Quantlys, Linear, GitHub, or a coding agent.
        </p>

        <h2>What &quot;built on Quantlys&quot; means here</h2>
        <ul>
          <li>
            The meeting app is a real product we use. It sits alongside the
            other products built on Quantlys:{" "}
            <a href="https://tablerene.com/">Tablerene</a> (an AI phone host
            for restaurants) and{" "}
            <a href="https://www.agilityserv.com/greenbook">GreenBook</a> (a
            bilingual landscaper CRM on Android).
          </li>
          <li>
            Its PRD rubrics are Conclave-compatible, so a meeting&apos;s PRD can
            be handed to Quantlys as the brief.
          </li>
          <li>
            The Quantlys platform and The Conclave stay closed. Only the
            meeting app is open source.
          </li>
        </ul>

        <h2>Open source since October 2, 2026</h2>
        <p>
          The repository{" "}
          <a href="https://github.com/SantoshA1/quantlys-meet">github.com/SantoshA1/quantlys-meet</a>{" "}
          went public with release{" "}
          <a href="https://github.com/SantoshA1/quantlys-meet/releases/tag/v1.0.0-oss">v1.0.0-oss</a>{" "}
          under the MIT license. It is the same code that runs
          quantlys-meeting.com. It is a Next.js app that uses LiveKit for
          realtime video, Deepgram for captions, Supabase for sign-in,
          history, and recording storage, and OpenAI or OpenRouter for the
          PRD and Memory writers. Recording happens in the host&apos;s browser
          as one continuous HD 720p file. See{" "}
          <Link href="/self-hosted-video-conferencing">self-hosted video conferencing</Link>{" "}
          for the operator&apos;s view.
        </p>

        <h2>Who builds it</h2>
        <p>
          <a href="https://santoshadari.com/">Santosh Adari</a> founded
          Quantlys and builds it in Apex, North Carolina. Quantlys is the
          product brand of Agility Business Services, Inc. Follow the build on{" "}
          <a href="https://www.linkedin.com/in/santoshadari">LinkedIn</a>,{" "}
          <a href="https://x.com/SantoshAdari1">X (@SantoshAdari1)</a>, and{" "}
          <a href="https://github.com/SantoshA1">GitHub</a>. Issues and pull
          requests are welcome on the repository.
        </p>

        <h2>Not to be confused with</h2>
        <p>
          Quantlys is not Quantalys, the fund-data company, and not Quantly,
          the finance AI company.
        </p>

        <h2>Start here</h2>
        <ul>
          <li><Link href="/">Quantlys Meeting home</Link>: host or join a meeting</li>
          <li><Link href="/meeting-that-writes-prd">Meeting that writes a PRD</Link></li>
          <li><Link href="/open-source-zoom-alternative">Open-source Zoom alternative</Link></li>
          <li><Link href="/memory-mode">Memory mode</Link> for podcasts and oral history</li>
          <li><a href="https://www.quantlys.ai/platform">The Quantlys platform</a></li>
        </ul>
      </article>
    </IntentShell>
  );
}
