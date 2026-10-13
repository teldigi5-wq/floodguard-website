import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AWS Amplify manual hosting accepts this static export. FloodGuard's live
  // Firebase listener runs in the browser, so no server runtime is required.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
