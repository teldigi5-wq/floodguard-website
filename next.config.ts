import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AWS Amplify manual hosting accepts this static export. FloodGuard's live
  // Firebase listener runs in the browser, so no server runtime is required.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // H35: Vercel supplies VERCEL_ENV during build. This immutable compile-time
  // signal prevents browser Firebase subscriptions from *any* Vercel preview
  // even when Preview and Production share NEXT_PUBLIC_FIREBASE_* variables.
  // Non-Vercel builds and production keep their pre-existing behavior.
  env: {
    FLOODGUARD_VERCEL_PREVIEW_BLOCK: process.env.VERCEL_ENV === "preview" ? "1" : "0",
  },
};

export default nextConfig;
