import type { MetadataRoute } from "next";

const lastModified = new Date("2026-08-31");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://quantlys-meeting.com/", lastModified, changeFrequency: "weekly", priority: 1 },
    { url: "https://quantlys-meeting.com/privacy", lastModified, changeFrequency: "monthly", priority: 0.4 },
    { url: "https://quantlys-meeting.com/recap-vs-prd", lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: "https://quantlys-meeting.com/example-prd", lastModified, changeFrequency: "weekly", priority: 0.7 },
  ];
}
