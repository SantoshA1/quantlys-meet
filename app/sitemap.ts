import type { MetadataRoute } from "next";

const lastModified = new Date("2026-10-02");
const sprint = new Date("2026-10-05");
const today = new Date("2026-10-06");
const brand = new Date("2026-10-08");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://quantlys-meeting.com/", lastModified: brand, changeFrequency: "weekly", priority: 1 },
    { url: "https://quantlys-meeting.com/browser-video-meeting-no-download", lastModified: sprint, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/open-source-zoom-alternative", lastModified: sprint, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/self-hosted-video-conferencing", lastModified: sprint, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/podcast-recording-in-browser", lastModified: sprint, changeFrequency: "weekly", priority: 0.85 },
    { url: "https://quantlys-meeting.com/ai-meeting-assistant-prd", lastModified: sprint, changeFrequency: "weekly", priority: 0.85 },
    { url: "https://quantlys-meeting.com/meeting-that-writes-prd", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/prd-from-meeting", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/open-source-video-meeting", lastModified: today, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/memory-mode", lastModified: sprint, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://quantlys-meeting.com/notes-vs-prd", lastModified, changeFrequency: "weekly", priority: 0.85 },
    { url: "https://quantlys-meeting.com/recap-vs-prd", lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: "https://quantlys-meeting.com/example-prd", lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: "https://quantlys-meeting.com/about", lastModified: brand, changeFrequency: "monthly", priority: 0.6 },
    { url: "https://quantlys-meeting.com/privacy", lastModified: today, changeFrequency: "monthly", priority: 0.4 },
  ];
}
