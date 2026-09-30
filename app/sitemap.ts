import type { MetadataRoute } from "next";

const lastModified = new Date("2026-09-30");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://quantlys-meeting.com/", lastModified, changeFrequency: "weekly", priority: 1 },
    { url: "https://quantlys-meeting.com/meeting-that-writes-prd", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/prd-from-meeting", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/notes-vs-prd", lastModified, changeFrequency: "weekly", priority: 0.85 },
    { url: "https://quantlys-meeting.com/recap-vs-prd", lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: "https://quantlys-meeting.com/example-prd", lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: "https://quantlys-meeting.com/privacy", lastModified, changeFrequency: "monthly", priority: 0.4 },
  ];
}
