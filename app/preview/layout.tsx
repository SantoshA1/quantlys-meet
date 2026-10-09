import type { Metadata } from "next";
import "./kit.css";
import Switcher from "./Switcher";

// Design-direction previews (A/B/C) for the homepage. Not linked from the
// site, not in the sitemap, and noindex so search engines never pick them up.
export const metadata: Metadata = {
  title: "Homepage directions (preview) | Quantlys Meeting",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Switcher />
    </>
  );
}
