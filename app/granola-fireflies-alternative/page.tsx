import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";
import {
  CompareJsonLd, CompareTable, EXPORT_CELL, FaqSection, HowWeCompared, PERSON_ID, PrdExport, REPO, SeeAlso, TrademarkNote,
  no, partial, txt, unlisted, yes, type Faq, type Row,
} from "../_seo/Compare";

const path = "/granola-fireflies-alternative";
const title = "Granola and Fireflies alternative for product teams | Quantlys Meeting";
const description =
  "Granola and Fireflies take notes on the calls you already have. Quantlys Meeting is an open-source meeting room that writes the PRD. Sourced comparison for product teams.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: Granola and Fireflies alternative for product teams");

// Official Granola and Fireflies pages, checked Oct 19, 2026.
const G_HOME = "https://www.granola.ai/";
const G_PRICING = "https://www.granola.ai/pricing";
const F_HOME = "https://fireflies.ai/";
const F_PRICING = "https://fireflies.ai/pricing";
const F_SPEC = "https://fireflies.ai/skills/product-management/product-spec-builder-ai-app";

const rows: Row[] = [
  { label: "Where the meeting happens", cells: [
    txt("Its own browser video room"),
    txt("Your existing app: Zoom, Meet, Teams and others", G_HOME),
    txt("Your existing app: Zoom, Meet, Teams and 10+ more", F_PRICING),
  ] },
  { label: "Bot in the call", cells: [
    txt("No bot; it is the call"),
    txt("No bot; uses your computer audio", G_HOME),
    txt("Notetaker bot, or a Chrome extension without the bot", F_PRICING),
  ] },
  { label: "In-person meetings", cells: [no(), yes("iPhone and Android apps", G_HOME), yes("Mobile app", F_HOME)] },
  { label: "Writes a product spec / PRD", cells: [
    yes("Markdown PRD from every meeting on a project"),
    unlisted(G_PRICING),
    yes("Product Spec Builder AI Skill", F_SPEC),
  ] },
  { label: "Asks the whole room follow-up questions to close spec gaps", cells: [
    yes("One question on everyone's screen, in a pause"),
    unlisted(G_HOME),
    unlisted(F_HOME),
  ] },
  { label: "Live help during the meeting", cells: [
    yes("“What did I miss?” private recap"),
    unlisted(G_HOME),
    yes("Live Assist: suggestions, coaching, answers", F_HOME),
  ] },
  { label: "Shows which spec sections are still missing", cells: [yes(), unlisted(G_HOME), unlisted(F_SPEC)] },
  { label: "Marks unsettled decisions TBD instead of guessing", cells: [yes(), unlisted(G_HOME), unlisted(F_SPEC)] },
  { label: "Custom note templates", cells: [
    txt("Rubrics: Agile Engineering, Game Studio, Research and more"),
    yes("Customized note templates and Recipes", G_PRICING),
    yes("200+ AI Skills", F_HOME),
  ] },
  { label: "Pre-meeting briefs", cells: [no(), yes("Business plan", G_PRICING), unlisted(F_PRICING)] },
  { label: "Integrations", cells: [
    partial(EXPORT_CELL),
    yes("Slack; Notion, HubSpot, Zapier on Business", G_PRICING),
    yes("CRM, project management, ATS, Slack", F_HOME),
  ] },
  { label: "MCP server for AI tools", cells: [no(), yes(undefined, G_PRICING), yes(undefined, F_HOME)] },
  { label: "Desktop and mobile apps", cells: [
    no("Browser only"),
    yes("macOS, Windows, iOS, Android", G_HOME),
    yes("Desktop and mobile", F_HOME),
  ] },
  { label: "SSO", cells: [no(), yes("Enterprise", G_PRICING), yes(undefined, F_PRICING)] },
  { label: "SOC 2 Type II", cells: [txt("None claimed"), yes(undefined, G_PRICING), yes(undefined, F_HOME)] },
  { label: "Open source / self-host", cells: [yes("MIT"), unlisted(G_PRICING), unlisted(F_PRICING)] },
  { label: "Free plan", cells: [
    txt("Self-host free under MIT; you pay your own vendors"),
    yes("Basic, $0, 30 days of history", G_PRICING),
    yes(undefined, F_PRICING),
  ] },
];

const faq: Faq[] = [
  {
    q: "How is Quantlys Meeting different from Granola and Fireflies?",
    a: "Granola and Fireflies take notes on the meetings you already hold in Zoom, Meet or Teams. Quantlys Meeting is its own browser meeting room, built for product spec sessions: a live agent asks the room about spec sections nobody has covered, and the recorded sessions on a project roll into one markdown PRD.",
  },
  {
    q: "Doesn't Fireflies also write PRDs?",
    a: "Yes. Fireflies lists a Product Spec Builder AI Skill that turns meeting discussions into product requirement documents. Quantlys Meeting's difference is that it works on the spec during the meeting, asking about missing sections while everyone is still in the room, and marks anything unsettled as TBD.",
  },
  {
    q: "Can I keep Granola or Fireflies and use Quantlys Meeting too?",
    a: "Yes. Keep your notetaker for everyday calls and send a Quantlys Meeting link for the planning sessions where you want a spec at the end.",
  },
  {
    q: "Is Quantlys Meeting open source?",
    a: "Yes. It is MIT-licensed at github.com/SantoshA1/quantlys-meet, and you can self-host it on your own LiveKit, Deepgram, Supabase, storage and model keys.",
  },
];

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description} ld={{ author: { "@id": PERSON_ID } }}>
      <CompareJsonLd path={path} items={faq} />
      <section className="qml-hero">
        <p className="qml-kicker">For product teams</p>
        <h1>A Granola and Fireflies alternative for product teams</h1>
        <p className="qml-lede">
          Granola and Fireflies are strong notetakers for the calls you already
          have. I built Quantlys Meeting as a side project for a narrower job:
          the product meeting where the team decides what to build. It&apos;s a
          browser meeting room that pushes the spec forward while you&apos;re
          talking and writes a markdown PRD when you&apos;re done.
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
        <h2>What Granola does better</h2>
        <ul>
          <li><strong>No new meeting link.</strong> It works with Zoom, Meet, Teams and other meeting apps using your computer audio, with no bot in the call.</li>
          <li><strong>Everywhere you meet.</strong> macOS, Windows, iOS and Android apps, including in-person meetings.</li>
          <li><strong>Before and after.</strong> Pre-meeting briefs, follow-up emails, and AI chat across your meetings.</li>
          <li><strong>Trust paperwork.</strong> SOC 2 Type II and SSO on Enterprise.</li>
        </ul>

        <h2>What Fireflies does better</h2>
        <ul>
          <li><strong>Coverage.</strong> Its notetaker joins Zoom, Meet, Teams and more, and it has desktop, mobile and Chrome extension options.</li>
          <li><strong>Automation.</strong> 200+ AI Skills, including a Product Spec Builder, plus CRM, project management and ATS integrations.</li>
          <li><strong>Analytics.</strong> Talk-time, topic trackers and conversation intelligence.</li>
          <li><strong>Enterprise.</strong> SOC 2 Type II, HIPAA and SSO.</li>
        </ul>

        <h2>What Quantlys Meeting does for a product team</h2>
        <ul>
          <li><strong>Gaps closed in the room.</strong> The host can turn on an agent that checks the conversation against a spec rubric and, in a pause, asks everyone one question about a missing section.</li>
          <li><strong>One PRD per project.</strong> Every recorded session feeds the same markdown PRD; the later meeting wins when two disagree, and anything unsettled stays TBD. See the <Link href="/example-prd">example PRD</Link> and <Link href="/recap-vs-prd">recap vs PRD</Link>.</li>
          <li><strong>Export where you ship.</strong> Send the PRD to GitHub, Linear, Jira or Notion from the Export menu, or paste the markdown into <a href="https://www.quantlys.ai">Quantlys</a> Conclave. Direct push is coming once enabled.</li>
          <li><strong>Open source.</strong> MIT, on <a href={REPO}>GitHub</a>.</li>
        </ul>

        <h2>Side by side</h2>
        <HowWeCompared vendors="Granola and Fireflies" />
        <CompareTable columns={["Quantlys Meeting", "Granola", "Fireflies"]} rows={rows} />

        <PrdExport />
        <FaqSection items={faq} />
        <SeeAlso />
        <TrademarkNote names="Zoom, Otter, Granola and Fireflies" />
      </article>
    </IntentShell>
  );
}
