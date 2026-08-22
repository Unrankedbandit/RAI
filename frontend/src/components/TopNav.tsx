"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "@/lib/clsx";
import { RaiLogo } from "./RaiLogo";

const links = [
  { href: "/", label: "Home" },
  { href: "/projects", label: "Current projects" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="flex h-[57px] flex-none items-center justify-between border-b border-hairline bg-canvas px-8">
      <Link href="/" className="flex items-center" aria-label="RAI home">
        <RaiLogo height={22} />
      </Link>
      <nav className="flex items-center gap-[26px]">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "text-[13.5px] font-medium transition-colors",
                active ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
