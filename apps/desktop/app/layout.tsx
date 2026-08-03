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
  // Draw under the notch / home indicator so env(safe-area-inset-*) engages and
  // the app renders edge-to-edge like a native shell.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0E0D12" },
    { media: "(prefers-color-scheme: light)", color: "#F7F7F9" },
  ],
};

export const metadata: Metadata = {
  title: "Giggle — Meet in squads",
  description: "Squad-based video encounter app",
  manifest: "/manifest.webmanifest",
  applicationName: "Giggle",
  // Installable, fullscreen "Add to Home Screen" behaviour on iOS — makes the
  // web app launch chrome-less like a native app, with a translucent status bar
  // over the app's own header.
  appleWebApp: {
    capable: true,
    title: "Giggle",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body suppressHydrationWarning style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>
        {/* External beforeInteractive script (loaded by src, not inline
            children) applies the saved theme pre-paint without the React 19
            "script tag while rendering" warning. */}
        <Script id="giggle-theme-init" src="/theme-init.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
