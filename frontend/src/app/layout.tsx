import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Poppins, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { SerwistProvider } from "@serwist/turbopack/react";
import "./globals.css";
import { SideNav } from "@/components/SideNav";
import { TopBar } from "@/components/TopBar";
import { ConsentGate } from "@/components/legal/ConsentGate";
import { InstallPrompt } from "@/components/ui/InstallPrompt";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "RAI",
  applicationName: "RAI",
  description:
    "AI due-diligence copilot for solar capital projects racing the ITC deadline.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RAI",
  },
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// Standalone title/status bar — the palette's near-black ink/oxford.
export const viewport: Viewport = {
  themeColor: "#0b0829",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${poppins.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="flex h-full bg-canvas text-ink">
        {/*
          Theme bootstrap — beforeInteractive injects this into <head> and runs
          it before first paint, so data-theme is set on <html> with no FOUC.
          Stored 'rai-theme' ('light'|'dark') wins; otherwise fall back to the
          OS preference; default light. Keep in sync with ui/ThemeToggle.tsx.
        */}
        <Script id="rai-theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("rai-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`}
        </Script>
        {/*
          Device gate — beforeInteractive, runs before first paint. Phones /
          tablets are redirected to the mobile UI; re-classifies live on
          resize / orientation / pointer / connection change so the two UIs
          interchange with device data. Override: ?ui=web (sticky, session).
        */}
        <Script src="/device-gate.js" strategy="beforeInteractive" />
        {/*
          PWA service worker — SerwistProvider registers /serwist/sw.js on
          load. Disabled outside production builds and a no-op where service
          workers are unsupported; a failed registration never blocks render.
          reloadOnOnline stays off so reconnects don't yank the map mid-task.
        */}
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV !== "production"}
          reloadOnOnline={false}
        >
          <SideNav />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="min-h-0 flex-1">{children}</main>
            <footer className="flex items-center justify-between gap-4 border-t border-hairline px-5 py-2 text-right text-[11.5px] text-faint">
              <span className="max-w-[50%] truncate text-left">
                Map data © CARTO, © OpenStreetMap contributors; imagery © Esri,
                Maxar, Earthstar Geographics
              </span>
              <Link href="/legal" className="underline-offset-2 hover:underline">
                Legal & privacy
              </Link>
            </footer>
          </div>
          <ConsentGate />
          <InstallPrompt />
        </SerwistProvider>
      </body>
    </html>
  );
}
