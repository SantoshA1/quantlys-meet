import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://quantlys-meeting.com/" },
    { url: "https://quantlys-meeting.com/privacy" },
  ];
}
