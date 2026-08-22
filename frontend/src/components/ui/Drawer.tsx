"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: number;
};

/** Right-side slide-in panel. Used for the evidence drawer. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 480,
}: DrawerProps) {
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
            className="fixed right-0 top-0 z-50 flex h-full max-w-[92vw] flex-col bg-white shadow-pop"
            style={{ width }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <header className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">{title}</h2>
                {subtitle && (
                  <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-3 py-1 text-sm font-medium text-muted hover:bg-surface-2"
              >
                Close
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
