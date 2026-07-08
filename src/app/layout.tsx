import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Scan your room with an iPhone, watch a home robot navigate your actual space, then order the real thing. The simulation layer for home robots.";

export const metadata: Metadata = {
  title: "Homie — Try a home robot in YOUR home",
  description: DESCRIPTION,
  applicationName: "Homie",
  icons: {
    // Robot glyph favicon; SVG for modern browsers, .ico fallback.
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
  openGraph: {
    title: "Homie — Try a home robot in YOUR home",
    description: DESCRIPTION,
    siteName: "Homie",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Homie — Try a home robot in YOUR home",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
