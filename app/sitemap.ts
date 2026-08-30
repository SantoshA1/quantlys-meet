import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://quantlys-meeting.com/" },
    { url: "https://quantlys-meeting.com/privacy" },
    { url: "https://quantlys-meeting.com/recap-vs-prd" },
    { url: "https://quantlys-meeting.com/example-prd" },
  ];
}
