import type { MetadataRoute } from "next";

/**
 * robots.txt for Quantlys Meeting.
 *
 * Important: Google treats Disallow as a *prefix* match. A rule like
 * `Disallow: /meeting` also blocks `/meeting-that-writes-prd`, and
 * `Disallow: /prd` also blocks `/prd-from-meeting`. App consoles use
 * trailing-slash prefixes (`/meeting/`, `/prd/`, `/memory/`) so SEO
 * marketing pages stay crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/meeting-that-writes-prd",
        "/prd-from-meeting",
        "/notes-vs-prd",
        "/example-prd",
        "/recap-vs-prd",
        "/open-source-video-meeting",
        "/memory-mode",
        "/browser-video-meeting-no-download",
        "/open-source-zoom-alternative",
        "/self-hosted-video-conferencing",
        "/podcast-recording-in-browser",
        "/ai-meeting-assistant-prd",
        "/privacy",
      ],
      disallow: [
        "/host",
        "/api",
        "/meeting/",
        "/meetings",
        "/room",
        "/auth",
        "/standup",
        "/prd/",
        "/memory/",
      ],
    },
    sitemap: "https://quantlys-meeting.com/sitemap.xml",
  };
}
