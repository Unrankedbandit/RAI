import type { Metadata } from "next";
import { Poppins, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SideNav } from "@/components/SideNav";
import { TopBar } from "@/components/TopBar";

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
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
