import type { Metadata,Viewport } from "next";
import "./globals.css";
import { FloodProvider } from "@/providers/flood-provider";
import { SiteChrome } from "@/components/site-chrome";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://production.dbe7czdo629dp.amplifyapp.com")),
  title: "FloodGuard | Smart Flood Monitoring & Dam Gate Control",
  description: "Real-time dam water monitoring, intelligent flood-risk detection and automated prototype gate response.",
  manifest: "/manifest.webmanifest",
  openGraph:{title:"FloodGuard | Monitor · Predict · Protect",description:"Real-time smart flood monitoring and automated prototype response.",type:"website",images:[{url:"/floodguard-brand.png",width:1536,height:1024,alt:"FloodGuard smart flood monitoring identity"}]},
  twitter:{card:"summary_large_image",title:"FloodGuard",description:"Smart Flood Monitoring & Dam Gate Control System",images:["/floodguard-brand.png"]},
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#061827",colorScheme:"dark"};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><a className="skip" href="#main-content">Skip to content</a><FloodProvider><SiteChrome>{children}</SiteChrome></FloodProvider></body>
    </html>
  );
}
