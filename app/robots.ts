import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/host",
        "/api",
        "/meeting",
        "/meetings",
        "/room",
        "/auth",
        "/standup",
        "/prd",
      ],
    },
    sitemap: "https://quantlys-meeting.com/sitemap.xml",
  };
}
