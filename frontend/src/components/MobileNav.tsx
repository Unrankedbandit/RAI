"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "@/lib/clsx";
import { RaiLogo } from "./RaiLogo";
import { links, isActive } from "./SideNav";

/**
 * Small-screen navigation: a hamburger in the top bar opens the same nav the
 * desktop sidebar shows, as a drawer over the content. Only rendered below md
 * (the button is md:hidden); desktop never mounts the drawer.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-2 md:hidden"
      >
        <svg viewBox="0 0 16 16" className="h-[16px] w-[16px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4.5h12M2 8h12M2 11.5h12" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[100] bg-[rgba(11,8,41,.35)] md:hidden"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="flex h-full w-[260px] max-w-[80vw] flex-col border-r border-hairline bg-canvas"
              initial={{ x: -270 }}
              animate={{ x: 0 }}
              exit={{ x: -270 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="flex h-[57px] items-center justify-between border-b border-hairline px-5">
                <Link href="/" aria-label="RAI home" onClick={() => setOpen(false)}>
                  <RaiLogo height={22} />
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full bg-surface-2 text-[15px] leading-none text-muted"
                >
                  ×
                </button>
              </div>
              <nav className="mt-2 flex flex-col gap-0.5 px-2.5">
                {links.map((link) => {
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-[7px] px-3 py-2.5 text-[14px] font-medium transition-colors",
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
