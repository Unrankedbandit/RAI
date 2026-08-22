"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IntakeDropzone } from "./IntakeDropzone";

/**
 * New-project intake modal — ShareModal's overlay/panel idiom hosting the
 * staged-intake dropzone. The dropzone mounts directly in its staged layout
 * (no hero zone); on a successful start it routes to /scanning and calls
 * onStarted, which we wire to onClose.
 */
export function IntakeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Escape closes (ShareModal has no keydown handler — added per spec).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(11,8,41,.35)]"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="max-h-[86vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-[11px] bg-canvas shadow-pop"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-hairline p-[18px_20px]">
              <div className="text-[15px] font-semibold text-ink">
                New project
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-[28px] w-[28px] cursor-pointer rounded-full bg-surface-2 text-[15px] leading-none text-muted"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-[20px]">
              <IntakeDropzone presentation="modal" onStarted={onClose} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
