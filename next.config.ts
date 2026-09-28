import type { NextConfig } from "next";

const isPages = process.env.GITHUB_PAGES === "1";

const tunnelHosts = [
  "*.trycloudflare.com",
  "*.loca.lt",
  "*.ngrok-free.app",
  "*.ngrok.io",
];

const nextConfig: NextConfig = {
  output: isPages ? "export" : undefined,
  basePath: isPages ? "/pdf-strip" : undefined,
  assetPrefix: isPages ? "/pdf-strip" : undefined,
  trailingSlash: isPages ? true : undefined,
  images: { unoptimized: isPages },
  allowedDevOrigins: tunnelHosts,
  experimental: {
    proxyClientMaxBodySize: "40mb",
    serverActions: {
      bodySizeLimit: "40mb",
      allowedOrigins: tunnelHosts,
    },
  },
};

export default nextConfig;
