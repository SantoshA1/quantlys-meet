/** @type {import("next").NextConfig} */
module.exports = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
  // App surfaces (rooms, consoles, shared PRD/Memory links, auth) must never
  // be indexed. robots.txt already disallows crawling them; this header is
  // the belt-and-braces for URLs Google learns about from links.
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      "/host", "/host/:path*", "/room/:path*", "/meeting/:path*", "/meetings",
      "/meetings/:path*", "/memory/:path*", "/prd/:path*", "/standup",
      "/auth/:path*", "/api/:path*",
    ].map((source) => ({ source, headers: noindex }));
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
