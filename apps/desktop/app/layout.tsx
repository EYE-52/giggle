import type { Metadata, Viewport } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";
import "./revamp.css";

const cabinet = localFont({
  src: [
    { path: "../public/fonts/CabinetGrotesk-Regular.woff2", weight: "400" },
    { path: "../public/fonts/CabinetGrotesk-Bold.woff2", weight: "700" },
    { path: "../public/fonts/CabinetGrotesk-Extrabold.woff2", weight: "800" },
  ], variable: "--font-cabinet", display: "swap",
});

// Explicit viewport export (Next 16 Metadata API: `viewport` object, not a
// <meta> tag or metadata.viewport) — Safari must render 1:1 with Chrome.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch / home indicator so env(safe-area-inset-*) engages and
  // the app renders edge-to-edge like a native shell.
  viewportFit: "cover",
  themeColor: "#faf7f2",
};

export const metadata: Metadata = {
  title: "Giggle — Meet in squads",
  description: "Meet new people. Bring your friends. Live video, together.",
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
    <html lang="en" suppressHydrationWarning className={cabinet.variable} data-theme="together">
      <body suppressHydrationWarning style={{ fontFamily: "var(--font-body)" }}>
        {/* External beforeInteractive script (loaded by src, not inline
            children) applies the saved theme pre-paint without the React 19
            "script tag while rendering" warning. */}
        <Script id="giggle-theme-init" src="/theme-init.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
