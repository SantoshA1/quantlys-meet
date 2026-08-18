import "@livekit/components-styles";
import "./globals.css";
import Image from "next/image";
import { THEME_BOOT, QSKIN } from "@/lib/theme";
import ThemeToggle from "./ThemeToggle";

export const metadata = { title: "Quantlys Meeting" };

// The two faces the design is built on, fetched by the browser rather than at
// build time. next/font self-hosts and is nicer — and it also makes the whole
// deploy depend on Google being reachable from the build machine, which is a
// bad trade for a typeface. `display=swap` means a missing font costs a
// reflow, never a blank page.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
        {/* Before first paint. Without this, somebody who chose light gets a
            black flash on every page load, which reads as a bug rather than a
            preference being honoured. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <style dangerouslySetInnerHTML={{ __html: QSKIN }} />
      </head>
      <body>
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <header className="brandbar">
            <Image src="/logo.svg" alt="Quantlys" width={22} height={22} className="logo" />
            <b>
              Quantlys<span style={{ color: "var(--accent2)", fontWeight: 400 }}> Meeting</span>
            </b>
            <span style={{ flex: 1 }} />
            <ThemeToggle />
          </header>
          <main style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
