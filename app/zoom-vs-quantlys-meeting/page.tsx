import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";
import {
  CompareJsonLd, CompareTable, FaqSection, HowWeCompared, PERSON_ID, PrdExport, REPO, SeeAlso, TrademarkNote,
  no, txt, unlisted, yes, type Faq, type Row,
} from "../_seo/Compare";

const path = "/zoom-vs-quantlys-meeting";
const title = "Zoom vs Quantlys Meeting for spec meetings | Quantlys Meeting";
const description =
  "Run your spec and planning meetings in Quantlys Meeting and keep Zoom for the rest. An honest, sourced comparison: what Zoom does better and what the spec room adds.";

export const metadata = intentMetadata(path, title, description, "Zoom vs Quantlys Meeting for spec meetings");

// Official Zoom pages, checked Oct 19, 2026.
const Z_FEATURES = "https://www.zoom.com/en/products/collaboration-tools/features/";
const Z_MEETINGS = "https://www.zoom.com/en/products/virtual-meetings/";
const Z_WEBINARS = "https://www.zoom.com/en/products/webinars/";
const Z_DIAL_IN = "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060564";
const Z_BROWSER = "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067293";
const Z_SSO = "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060673";

const rows: Row[] = [
  { label: "Guests join from a browser, no install", cells: [
    yes("Link + name, no account"),
    yes("“Join from your browser” link, on by default", Z_BROWSER),
  ] },
  { label: "Desktop and mobile apps", cells: [no("Browser only"), yes("Desktop, mobile, room systems", Z_MEETINGS)] },
  { label: "Phone dial-in", cells: [no(), yes("Toll numbers on all plans; toll-free with Audio Plan", Z_DIAL_IN)] },
  { label: "Webinars and large events", cells: [no(), yes("Webinars up to 100,000 attendees", Z_WEBINARS)] },
  { label: "Room hardware", cells: [no(), yes("Zoom Rooms", Z_MEETINGS)] },
  { label: "SSO and enterprise admin", cells: [
    no("Optional single email-domain limit for hosts only"),
    yes("SAML / OIDC SSO on Business and up", Z_SSO),
  ] },
  { label: "Live captions", cells: [
    yes("Deepgram, with participant-name and glossary boosting"),
    yes("Translated captions in 33 languages", Z_FEATURES),
  ] },
  { label: "Catch up mid-meeting", cells: [
    yes("“What did I miss?”: private recap of the last ~5 min"),
    yes("AI Companion in-meeting queries", Z_FEATURES),
  ] },
  { label: "AI summary after the meeting", cells: [yes("Notes per recording"), yes("Summary and next steps", Z_FEATURES)] },
  { label: "Asks the room follow-up questions to close spec gaps", cells: [
    yes("One question at a time, in a pause, capped per meeting"),
    unlisted(Z_FEATURES),
  ] },
  { label: "Writes a markdown PRD from every meeting on a project", cells: [yes(), unlisted(Z_FEATURES)] },
  { label: "Shows which spec sections are still missing", cells: [yes("Per-section readiness with a question for each gap"), unlisted(Z_FEATURES)] },
  { label: "Source code you can read and self-host", cells: [yes("MIT"), unlisted(Z_MEETINGS)] },
  { label: "Built for", cells: [txt("Small working sessions that should end in a spec"), txt("Every kind of meeting, at scale", Z_MEETINGS)] },
];

const faq: Faq[] = [
  {
    q: "Should I replace Zoom with Quantlys Meeting?",
    a: "No. Keep Zoom for most of your meetings. It is more reliable at scale and has phone dial-in, webinars, room systems and enterprise admin, which Quantlys Meeting does not. Use Quantlys Meeting for the spec and planning sessions where you want a PRD at the end.",
  },
  {
    q: "What does Quantlys Meeting do in a spec meeting that Zoom does not?",
    a: "A live agent can put one follow-up question on screen during a pause when a spec section is still missing, and the recorded sessions on a project roll into one markdown PRD you can export to GitHub, Linear, Jira or Notion. Zoom's own feature pages list AI summaries and in-meeting queries, not a PRD writer.",
  },
  {
    q: "Do guests need an account or an app?",
    a: "No. Guests open the link in a browser and type a name. Only the host signs in.",
  },
  {
    q: "Is Quantlys Meeting open source?",
    a: "Yes. It is MIT-licensed at github.com/SantoshA1/quantlys-meet, and you can self-host it with your own LiveKit, Deepgram, Supabase, storage and model keys.",
  },
];

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description} ld={{ author: { "@id": PERSON_ID } }}>
      <CompareJsonLd path={path} items={faq} />
      <section className="qml-hero">
        <p className="qml-kicker">Spec meetings · keep Zoom for the rest</p>
        <h1>Zoom vs Quantlys Meeting for spec meetings</h1>
        <p className="qml-lede">
          I&apos;m Santosh, and Quantlys Meeting is my side project. My pitch is
          small on purpose: run your spec and planning meetings here, and keep
          Zoom for everything else. Zoom is the better general meeting tool.
          This room is built for one job, ending a product conversation with a
          PRD instead of a recap.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a spec meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            See an example PRD
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>What Zoom does better</h2>
        <ul>
          <li><strong>Reliability at scale.</strong> Zoom runs webinars for up to 100,000 attendees. Quantlys Meeting is a small deployment meant for working sessions.</li>
          <li><strong>Phone dial-in.</strong> Zoom lets people join by phone. Quantlys Meeting is browser-only.</li>
          <li><strong>Webinars and events.</strong> Zoom has a full webinar and events product. Quantlys Meeting has none.</li>
          <li><strong>Enterprise admin.</strong> Zoom has SSO, an admin center and room systems. Quantlys Meeting has a host sign-in and an optional email-domain limit.</li>
          <li><strong>Apps everywhere.</strong> Zoom has desktop, mobile and room apps. Quantlys Meeting runs in a browser tab.</li>
        </ul>

        <h2>What the spec room adds</h2>
        <ul>
          <li><strong>Live follow-up questions.</strong> When the host turns the agent on, it waits for a pause and puts one question on everyone&apos;s screen about a spec section nobody has covered yet. It never stacks questions and stops after a per-meeting cap.</li>
          <li><strong>A PRD, not a recap.</strong> Recorded sessions on a project roll into one markdown PRD. When the room didn&apos;t settle something, the PRD says TBD instead of inventing it. See the <Link href="/example-prd">example PRD</Link>.</li>
          <li><strong>&ldquo;What did I miss?&rdquo;</strong> A private recap of the last ~5 minutes for whoever clicks it, including what changed in the PRD.</li>
          <li><strong>Captions that spell your jargon.</strong> Participant names and a glossary of up to 50 terms are sent to the caption engine.</li>
          <li><strong>Open source.</strong> MIT, on <a href={REPO}>GitHub</a>.</li>
        </ul>

        <h2>Side by side</h2>
        <HowWeCompared vendors="Zoom" />
        <CompareTable columns={["Quantlys Meeting", "Zoom"]} rows={rows} />

        <h2>How I&apos;d use both</h2>
        <p>
          Keep the standing calls, all-hands, customer calls and webinars on
          Zoom. When a meeting&apos;s job is to decide what to build, send a
          Quantlys Meeting link instead. Record it, and{" "}
          <Link href="/prd-from-meeting">build the PRD from the session</Link>.
          Then export it to GitHub, Linear, Jira or Notion, or paste the
          markdown into <a href="https://www.quantlys.ai">Quantlys</a> Conclave.
        </p>

        <PrdExport />
        <FaqSection items={faq} />
        <SeeAlso />
        <TrademarkNote names="Zoom, Otter, Granola and Fireflies" />
      </article>
    </IntentShell>
  );
}
