// Security headers (audit 2026-10-12).
// Enforced: framing (frame-ancestors + X-Frame-Options), nosniff, referrer,
// permissions, HSTS. The full content policy ships as Report-Only first so a
// missed origin (LiveKit SFU, Deepgram, Supabase, CDN fallbacks) shows up as a
// console report instead of a broken meeting; promote it once reports are clean.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://va.vercel-scripts.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co wss://*.livekit.cloud https://*.livekit.cloud wss://api.deepgram.com https://api.deepgram.com https://va.vercel-scripts.com https://cdn.jsdelivr.net https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), autoplay=(self), geolocation=(), payment=(), usb=()",
  },
  // includeSubDomains is safe: every *.quantlys-meeting.com name is a Vercel
  // wildcard ALIAS served over HTTPS. Not adding `preload` (hard to undo).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import("next").NextConfig} */
module.exports = {
  reactStrictMode: true,
  // App surfaces (rooms, consoles, shared PRD/Memory links, auth) must never
  // be indexed. robots.txt already disallows crawling them; this header is
  // the belt-and-braces for URLs Google learns about from links.
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    const noindexRules = [
      "/host", "/host/:path*", "/room/:path*", "/meeting/:path*", "/meetings",
      "/meetings/:path*", "/memory/:path*", "/prd/:path*", "/standup",
      "/auth/:path*", "/api/:path*",
    ].map((source) => ({ source, headers: noindex }));
    return [{ source: "/:path*", headers: SECURITY_HEADERS }, ...noindexRules];
  },
  // Turbopack (default bundler in Next 16) equivalent of the webpack aliases.
  turbopack: {
    resolveAlias: { sharp: "./lib/empty-module.js", "onnxruntime-node": "./lib/empty-module.js" },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      sharp: false,
      "onnxruntime-node": false,
    };
    return config;
  },
};
