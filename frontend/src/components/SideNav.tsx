"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "@/lib/clsx";
import { RaiLogo } from "./RaiLogo";

/**
 * Left-hand app navigation. Active state is a background fill (--color-select),
 * never a border — the brand's selection rule applied to chrome.
 */

const links = [
  {
    href: "/",
    label: "Home",
    icon: (
      <path d="M2.5 7 8 2.5 13.5 7v6.5a1 1 0 0 1-1 1H9.5v-4h-3v4H3.5a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    ),
  },
  {
    href: "/discover",
    label: "Discover",
    icon: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="m10.2 5.8-1.2 3.2-3.2 1.2 1.2-3.2z" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: "/parcels",
    label: "Parcels",
    icon: (
      <path d="M2.5 5.5 8 2.5l5.5 3M2.5 8.5 8 5.5l5.5 3M2.5 11.5 8 8.5l5.5 3v2l-5.5 3-5.5-3z" strokeLinejoin="round" />
    ),
  },
  {
    href: "/projects",
    label: "Current projects",
    icon: (
      <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 2h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    ),
  },
  {
    href: "/findings",
    label: "Findings",
    icon: <path d="M3 13.5v-11h3l7 3-7 3H3" strokeLinejoin="round" />,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <>
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" strokeLinecap="round" />
      </>
    ),
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function SideNav() {
  const pathname = usePathname();

  return (
    <aside className="flex w-[218px] flex-none flex-col border-r border-hairline bg-canvas">
      <Link href="/" className="flex h-[57px] items-center px-5" aria-label="RAI home">
        <RaiLogo height={22} />
      </Link>
      <nav className="mt-2 flex flex-col gap-0.5 px-2.5">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "flex items-center gap-2.5 rounded-[7px] px-3 py-2 text-[13.5px] font-medium transition-colors",
                active
                  ? "bg-select text-ink"
                  : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-[15px] w-[15px] flex-none"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden="true"
              >
                {link.icon}
              </svg>
              <span className="min-w-0 truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
