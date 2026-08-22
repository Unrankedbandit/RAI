import type { Metadata } from "next";
import { Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/TopNav";

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
      className={`${poppins.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="flex h-full flex-col bg-canvas text-ink">
        <TopNav />
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
