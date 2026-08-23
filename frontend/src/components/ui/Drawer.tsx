"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { clsx } from "@/lib/clsx";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: number;
  /**
   * Phones (below md): dock as a bottom sheet — full-width, slides up,
   * drag-handle grip, large close target — instead of the right panel.
   * Desktop renders the unchanged right-side drawer either way.
   */
  bottomSheetOnMobile?: boolean;
};

/** Live matchMedia listener — false until mounted, then tracks the query. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Right-side slide-in panel. Used for the evidence drawer. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 480,
  bottomSheetOnMobile = false,
}: DrawerProps) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const sheet = bottomSheetOnMobile && narrow;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className={clsx(
              "fixed z-50 flex flex-col bg-canvas shadow-pop",
              sheet
                ? "inset-x-0 bottom-0 max-h-[80dvh] rounded-t-2xl"
                : "right-0 top-0 h-full max-w-[92vw]",
            )}
            style={sheet ? undefined : { width }}
            initial={sheet ? { y: "100%" } : { x: "100%" }}
            animate={sheet ? { y: 0 } : { x: 0 }}
            exit={sheet ? { y: "100%" } : { x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {sheet && (
              <span
                aria-hidden
                className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-hairline"
              />
            )}
            <header
              className={clsx(
                "flex items-start justify-between gap-4 border-b border-hairline",
                sheet ? "px-4 py-3" : "px-6 py-5",
              )}
            >
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink">{title}</h2>
                {subtitle && (
                  <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className={clsx(
                  "shrink-0 cursor-pointer rounded-full text-sm font-medium text-muted hover:bg-surface-2",
                  sheet ? "px-4 py-3" : "px-3 py-1",
                )}
              >
                Close
              </button>
            </header>
            <div
              className={clsx(
                "flex-1 overflow-y-auto",
                sheet
                  ? "px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4"
                  : "px-6 py-5",
              )}
            >
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
