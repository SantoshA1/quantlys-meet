import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";
import {
  CompareJsonLd, CompareTable, FaqSection, HowWeCompared, PERSON_ID, REPO, SeeAlso, TrademarkNote,
  no, txt, unlisted, yes, type Faq, type Row,
} from "../_seo/Compare";

const path = "/otter-alternative";
const title = "Otter alternative that writes a PRD | Quantlys Meeting";
const description =
  "Otter writes meeting notes. Quantlys Meeting is an open-source browser meeting room that writes a markdown PRD. Honest, sourced comparison, including what Otter does better.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: an Otter alternative that writes a PRD");

// Official Otter pages, checked Oct 19, 2026.
const O_HOME = "https://otter.ai/";
const O_PRICING = "https://otter.ai/pricing";

const rows: Row[] = [
  { label: "Where the meeting happens", cells: [
    txt("Its own browser video room"),
    txt("Joins Zoom, Teams and Meet, or records from its desktop, mobile or browser apps", O_HOME),
  ] },
  { label: "Works inside your existing Zoom / Teams / Meet calls", cells: [no("You meet in its room"), yes(undefined, O_PRICING)] },
  { label: "Live transcription", cells: [yes("Deepgram captions"), yes(undefined, O_PRICING)] },
  { label: "Live prompts during the call", cells: [
    yes("Follow-up questions that close spec gaps"),
    yes("Live-Assist coaching and prompts", O_HOME),
  ] },
  { label: "Summary with action items", cells: [yes("Notes per recording"), yes("Summaries with action items and outlines", O_PRICING)] },
  { label: "Writes a markdown PRD from every meeting on a project", cells: [yes(), unlisted(O_HOME)] },
  { label: "Shows which spec sections are still missing", cells: [yes(), unlisted(O_HOME)] },
  { label: "Custom vocabulary", cells: [
    yes("Participant names + glossary of up to 50 terms"),
    yes("Team vocabulary on paid plans", O_PRICING),
  ] },
  { label: "Caption file export", cells: [yes(".vtt and .srt"), yes(".srt on paid plans", O_PRICING)] },
  { label: "Private catch-up while the meeting runs", cells: [yes("“What did I miss?”"), unlisted(O_HOME)] },
  { label: "Mobile apps", cells: [no("Browser only"), yes("iOS and Android", O_PRICING)] },
  { label: "Built-in integrations", cells: [
    no("Download markdown and paste it"),
    yes("Salesforce, HubSpot, Zapier, Slack, Jira, Notion and more", O_HOME),
  ] },
  { label: "SSO / SCIM", cells: [no(), yes("Enterprise", O_PRICING)] },
  { label: "Free plan", cells: [
    txt("Self-host free under MIT; you pay your own vendors"),
    yes("Basic, with 300 monthly transcription minutes", O_PRICING),
  ] },
  { label: "Open source / self-host", cells: [yes("MIT"), unlisted(O_PRICING)] },
];

const faq: Faq[] = [
  {
    q: "Is Quantlys Meeting a drop-in Otter replacement?",
    a: "No. Otter joins the Zoom, Teams and Meet calls you already have and has mobile apps and CRM integrations. Quantlys Meeting is its own browser meeting room, built for spec and planning sessions that should end in a PRD.",
  },
  {
    q: "What does Quantlys Meeting write instead of notes?",
    a: "The recorded sessions on a project roll into one markdown PRD. When the room didn't settle something, the PRD marks it TBD instead of inventing it. You download the markdown and paste it into Linear, GitHub or Quantlys Conclave.",
  },
  {
    q: "Does Otter ask questions during the meeting?",
    a: "Otter's site lists Live-Assist coaching and prompts during calls. Quantlys Meeting's live agent is narrower: it asks one question at a time about spec sections nobody has covered yet.",
  },
  {
    q: "Can I self-host Quantlys Meeting?",
    a: "Yes. It is MIT-licensed. You bring LiveKit, Deepgram, Supabase, S3-compatible storage and an OpenAI or OpenRouter key.",
  },
];

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description} ld={{ author: { "@id": PERSON_ID } }}>
      <CompareJsonLd path={path} items={faq} />
      <section className="qml-hero">
        <p className="qml-kicker">Notes vs a spec</p>
        <h1>An Otter alternative that writes a PRD</h1>
        <p className="qml-lede">
          Otter is a good notetaker. I built Quantlys Meeting as a side
          project because notes weren&apos;t what my planning meetings needed.
          I needed the spec. It&apos;s a browser meeting room where the
          recorded session writes a markdown PRD, and an optional agent asks
          the questions that would otherwise wait for the next meeting.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a meeting
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            See an example PRD
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>What Otter does better</h2>
        <ul>
          <li><strong>It comes to your meetings.</strong> Otter joins Zoom, Teams and Google Meet. Quantlys Meeting asks people to meet in its own room.</li>
          <li><strong>Apps and in-person.</strong> Otter has iOS and Android apps and bot-free desktop recording. Quantlys Meeting runs only in a browser.</li>
          <li><strong>Integrations.</strong> Otter syncs to Salesforce, HubSpot, Slack, Jira, Notion and more. Quantlys Meeting gives you a markdown file.</li>
          <li><strong>Enterprise.</strong> Otter lists SSO, SCIM and a HIPAA add-on on its pricing page. Quantlys Meeting has none of these.</li>
        </ul>

        <h2>What Quantlys Meeting does differently</h2>
        <ul>
          <li><strong>The output is a PRD.</strong> Problem, users, scope, decisions and open questions, written from what the meetings actually settled. See the <Link href="/example-prd">example PRD</Link> and <Link href="/notes-vs-prd">notes vs PRD</Link>.</li>
          <li><strong>Questions that close gaps.</strong> The host can turn on an agent that asks one follow-up question in a pause, only about spec sections still missing, with a cap per meeting.</li>
          <li><strong>Many meetings, one spec.</strong> Every recorded session on a project feeds the same PRD, and the later meeting wins when two disagree.</li>
          <li><strong>Open source.</strong> MIT, on <a href={REPO}>GitHub</a>. Run it on your own keys.</li>
        </ul>

        <h2>Side by side</h2>
        <HowWeCompared vendors="Otter" />
        <CompareTable columns={["Quantlys Meeting", "Otter"]} rows={rows} />

        <h2>When to pick which</h2>
        <p>
          Pick Otter if you want notes from every call you already have, on
          every device, synced to your CRM. Pick Quantlys Meeting for the few
          sessions a week where the team decides what to build, and you want
          the spec out of the room. Using both works fine.
        </p>

        <FaqSection items={faq} />
        <SeeAlso />
        <TrademarkNote names="Zoom, Otter, Granola and Fireflies" />
      </article>
    </IntentShell>
  );
}
