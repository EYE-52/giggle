import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Explicit viewport export (Next 16 Metadata API: `viewport` object, not a
// <meta> tag or metadata.viewport) — Safari must render 1:1 with Chrome.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Giggle — Meet in squads",
  description: "Squad-based video encounter app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>
        {/* External beforeInteractive script (loaded by src, not inline
            children) applies the saved theme pre-paint without the React 19
            "script tag while rendering" warning. */}
        <Script id="giggle-theme-init" src="/theme-init.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
