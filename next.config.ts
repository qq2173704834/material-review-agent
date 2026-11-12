import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pdfjs-dist", "sharp", "tesseract.js", "@napi-rs/canvas"],
};

export default nextConfig;
