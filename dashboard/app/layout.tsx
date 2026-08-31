import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const fallbackOrigin = "http://localhost:3000";
const safeHost = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

async function getRequestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();

  if (!host || !safeHost.test(host)) return fallbackOrigin;

  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : isLocal
        ? "http"
        : "https";

  return `${protocol}://${host}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const origin = await getRequestOrigin();
  const imageUrl = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: "ThetaShield — Directional LP Protection",
    description:
      "A Uniswap v4 hook that separates persistent directional adverse selection from ordinary volatility.",
    applicationName: "ThetaShield",
    keywords: ["Uniswap v4", "Circle CCTP", "dynamic fees", "LP protection", "markout"],
    alternates: { canonical: origin },
    // public/favicon.svg shipped unreferenced, in a lime that is not the
    // project's palette. Recoloured and wired, so the product has a tab identity.
    icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
    openGraph: {
      title: "ThetaShield — Protect LPs from signal, not noise.",
      description: "Persistent, directional fee protection for Uniswap v4 liquidity providers.",
      type: "website",
      url: origin,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "ThetaShield directional LP protection" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ThetaShield — Directional LP Protection",
      description: "Protect LPs from signal, not noise.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
