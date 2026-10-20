import Link from "next/link";
import { SITE } from "./IntentShell";

// Shared pieces for the competitor comparison pages
// (/zoom-vs-quantlys-meeting, /otter-alternative,
// /self-hosted-zoom-alternative, /granola-fireflies-alternative).
//
// THE RULES THESE ENCODE (so a page can't quietly break them):
//   · every competitor cell carries the official source it was checked on;
//   · a competitor only gets ✗ when their own site says so — otherwise the
//     cell reads "Not listed on their site", linked to the page we checked;
//   · FAQ JSON-LD is generated from the SAME array the page renders, so the
//     structured data can never say something the visible page doesn't;
//   · every page ends with the trademark / not-affiliated / corrections note.

export const PERSON_ID = "https://santoshadari.com/#person";
export const REPO = "https://github.com/SantoshA1/quantlys-meet";
export const CHECKED = "Oct 19, 2026";
export const CHECKED_SHORT = "as of Oct 2026";
export const CORRECTIONS = "admin@agilityserv.com";

export type Cell =
  | { k: "yes"; note?: string; src?: string }
  | { k: "no"; note?: string; src?: string }
  | { k: "partial"; note: string; src?: string }
  | { k: "text"; note: string; src?: string }
  | { k: "unlisted"; src: string };

export const yes = (note?: string, src?: string): Cell => ({ k: "yes", note, src });
export const no = (note?: string, src?: string): Cell => ({ k: "no", note, src });
export const partial = (note: string, src?: string): Cell => ({ k: "partial", note, src });
export const txt = (note: string, src?: string): Cell => ({ k: "text", note, src });
export const unlisted = (src: string): Cell => ({ k: "unlisted", src });

function Src({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} rel="nofollow noopener" target="_blank">
      {children}
    </a>
  );
}

function CellView({ c }: { c: Cell }) {
  switch (c.k) {
    case "yes":
      return (
        <>
          <span aria-label="Yes">✓</span>
          {c.note ? <> {c.src ? <Src href={c.src}>{c.note}</Src> : c.note}</> : null}
        </>
      );
    case "no":
      return (
        <>
          <span aria-label="No">✗</span>
          {c.note ? <> {c.src ? <Src href={c.src}>{c.note}</Src> : c.note}</> : null}
        </>
      );
    case "partial":
      return (
        <>
          Partial: <Src href={c.src}>{c.note}</Src>
        </>
      );
    case "text":
      return <Src href={c.src}>{c.note}</Src>;
    case "unlisted":
      return (
        <span style={{ opacity: 0.75 }}>
          <Src href={c.src}>Not listed on their site</Src>
        </span>
      );
  }
}

export type Row = { label: string; cells: Cell[] };

export function CompareTable({ columns, rows }: { columns: string[]; rows: Row[] }) {
  return (
    <div className="qml-tablewrap">
      <table>
        <thead>
          <tr>
            <th></th>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {r.cells.map((c, i) => (
                <td key={i}>
                  <CellView c={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HowWeCompared({ vendors }: { vendors: string }) {
  return (
    <p>
      <strong>How I compared.</strong> Quantlys Meeting rows come from the
      public{" "}
      <a href={REPO}>source code and README</a> (v1.1.3). {vendors} rows were
      checked on each vendor&apos;s own website or help center on {CHECKED}{" "}
      ({CHECKED_SHORT}); every cell links to the page it came from. ✗ means
      the vendor&apos;s own page says it isn&apos;t offered. &ldquo;Not listed
      on their site&rdquo; means I couldn&apos;t find it on their official
      pages, not that it doesn&apos;t exist. Plans and features change, so
      check the vendor before you decide.
    </p>
  );
}

export type Faq = { q: string; a: string };

export function FaqSection({ items }: { items: Faq[] }) {
  return (
    <>
      <h2>FAQ</h2>
      {items.map((f) => (
        <div key={f.q}>
          <h3 style={{ fontSize: 16, margin: "18px 0 6px" }}>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}
    </>
  );
}

/** FAQPage + author graph for a comparison page. Built from the same `items`
 *  FaqSection renders, so the markup always matches the visible text. */
export function CompareJsonLd({ path, items }: { path: string; items: Faq[] }) {
  const url = `${SITE}${path}`;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        url,
        author: { "@id": PERSON_ID },
        mainEntity: items.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: "Santosh Adari",
        url: "https://santoshadari.com/",
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }}
    />
  );
}

export function TrademarkNote({ names }: { names: string }) {
  return (
    <p style={{ fontSize: 13 }}>
      {names} are trademarks of their respective owners. Quantlys Meeting is
      not affiliated with, sponsored by, or endorsed by them. Competitor
      details were checked on their official sites on {CHECKED} and may have
      changed since. Spot something wrong or out of date? Email{" "}
      <a href={`mailto:${CORRECTIONS}`}>{CORRECTIONS}</a> and I&apos;ll fix it.
    </p>
  );
}

export function SeeAlso() {
  return (
    <>
      <h2>Go deeper</h2>
      <ul>
        <li>
          <Link href="/example-prd">Example PRD</Link>: a labeled specimen of what
          the room writes (not a customer recording).
        </li>
        <li>
          <Link href="/prd-from-meeting">PRD from a meeting</Link>: how recorded
          sessions on a project become one markdown spec.
        </li>
        <li>
          <Link href="/open-source-video-meeting">Open-source video conferencing</Link>:
          the MIT repo and the keys you bring.
        </li>
        <li>
          Source: <a href={REPO}>github.com/SantoshA1/quantlys-meet</a> (MIT)
        </li>
        <li>
          Built by <a href="https://santoshadari.com">Santosh Adari</a> on{" "}
          <a href="https://www.quantlys.ai">Quantlys</a>.
        </li>
      </ul>
    </>
  );
}
