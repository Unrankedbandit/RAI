import type { Metadata } from "next";
import Link from "next/link";
import { Poppins, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SideNav } from "@/components/SideNav";
import { TopBar } from "@/components/TopBar";
import { ConsentGate } from "@/components/legal/ConsentGate";

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
  description:
    "AI due-diligence copilot for solar capital projects racing the ITC deadline.",
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
      </body>
    </html>
  );
}
