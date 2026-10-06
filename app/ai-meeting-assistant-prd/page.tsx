import Link from "next/link";
import { IntentShell, intentMetadata } from "../_seo/IntentShell";

const path = "/ai-meeting-assistant-prd";
const title = "AI meeting assistant that writes the PRD | Quantlys Meeting";
const description =
  "Notetakers summarize after the call. Quantlys' in-room AI asks the missing spec questions during the meeting, then the session writes a markdown PRD.";

export const metadata = intentMetadata(path, title, description, "Quantlys Meeting: AI meeting assistant that writes the PRD");

export default function Page() {
  return (
    <IntentShell path={path} title={title} description={description}>
      <section className="qml-hero">
        <p className="qml-kicker">Asks during · writes after</p>
        <h1>AI meeting assistant that writes the PRD</h1>
        <p className="qml-lede">
          Most AI meeting assistants listen and then summarize. Quantlys
          Meeting&rsquo;s assistant sits in the room and asks the questions
          your spec is still missing, while the people who can answer are
          there. When the call ends, the recorded session writes a markdown
          PRD, not a page of notes.
        </p>
        <div className="qml-cta">
          <Link className="qml-btn qml-btn-primary" href="/host">
            Host a spec session
          </Link>
          <Link className="qml-btn qml-btn-ghost" href="/example-prd">
            See an example PRD
          </Link>
        </div>
      </section>

      <article className="qml-legal">
        <h2>What the in-room assistant does</h2>
        <ul>
          <li>
            The host turns it on with one click. It reads the live captions
            the meeting already produces, so there is no second transcription.
          </li>
          <li>
            About once a minute it checks whether a spec gap (for example,
            acceptance criteria or an open decision) is still open and whether
            this is a good moment to ask. It is built to stay quiet most of
            the time.
          </li>
          <li>
            When it does ask, it asks one question, shown to everyone in the
            room. Someone answers out loud, or taps an answer so it goes into
            the record.
          </li>
          <li>
            Questions are capped per meeting, so it can&rsquo;t take over the
            call.
          </li>
        </ul>

        <h2>Notetaker vs Quantlys</h2>
        <div className="qml-tablewrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Typical AI notetaker</th>
                <th>Quantlys Meeting</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>How it joins</td>
                <td>A bot joins your Zoom, Meet, or Teams call</td>
                <td>It is the meeting: a browser video room</td>
              </tr>
              <tr>
                <td>During the call</td>
                <td>Listens</td>
                <td>Asks the questions the spec still needs</td>
              </tr>
              <tr>
                <td>After the call</td>
                <td>Transcript, summary, action items</td>
                <td>Markdown PRD: problem, user stories, acceptance criteria, decisions, open questions</td>
              </tr>
              <tr>
                <td>Across meetings</td>
                <td>One summary per call</td>
                <td>Sessions on a project roll into one PRD</td>
              </tr>
              <tr>
                <td>Works with your existing meeting app</td>
                <td>Yes, which is its main strength</td>
                <td>No. You hold the session in Quantlys</td>
              </tr>
              <tr>
                <td>Source</td>
                <td>Usually closed</td>
                <td>MIT, self-hostable</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          If your team will never leave Zoom or Teams, a notetaker that joins
          those calls is the easier choice. Quantlys is worth trying for the
          product review itself: the call where the spec should get decided.
        </p>

        <h2>Where the PRD goes</h2>
        <p>
          The PRD is plain markdown. Paste it into Linear, GitHub, Notion, or
          your coding agent. There is no lock-in format. More on the output:{" "}
          <Link href="/meeting-that-writes-prd">meeting that writes a PRD</Link>,{" "}
          <Link href="/notes-vs-prd">meeting notes vs a PRD</Link>, and{" "}
          <Link href="/recap-vs-prd">Zoom recap vs a PRD</Link>.
        </p>

        <h2>What it runs on</h2>
        <p>
          LiveKit for video, Deepgram for captions, and OpenAI or OpenRouter
          for the assistant and the PRD writer. Hosted at quantlys-meeting.com,
          or <Link href="/self-hosted-video-conferencing">self-hosted</Link>{" "}
          on your own keys. Guests{" "}
          <Link href="/browser-video-meeting-no-download">join from a link with no download</Link>.
        </p>
      </article>
    </IntentShell>
  );
}
