import type { Metadata } from "next";
import HomeLanding from "./HomeLanding";

export const metadata: Metadata = {
  title: "Quantlys Meeting — leave the call with a spec, not notes",
  description:
    "Video in a browser tab. Guests need a link, not an account. The working session writes a PRD: user stories, acceptance criteria, decisions, and open questions.",
  openGraph: {
    title: "Quantlys Meeting — the meeting that writes the PRD",
    description:
      "Guests join in a tab. Hosts leave with a spec. Later, run it on your cloud with your models.",
    url: "https://quantlys-meeting.com/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quantlys Meeting — the meeting that writes the PRD",
    description:
      "Guests join in a tab. Hosts leave with a spec.",
  },
};

export default function Page() {
  return <HomeLanding />;
}
