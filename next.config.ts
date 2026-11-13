import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: { proxyClientMaxBodySize: "52mb" },
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: [
    "pdfjs-dist",
    "sharp",
    "tesseract.js",
    "@napi-rs/canvas",
    "@ffmpeg-installer/win32-x64",
    "@ffprobe-installer/win32-x64",
  ],
};

export default nextConfig;
