"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const KEY = "rai-map-intro-v1";

/**
 * One-time map intro — the simplest possible explanation of the parcel viewer,
 * shown once per device the first time /parcels loads (the landing page's
 * "Get started" drops new users here). Never reappears after dismissal.
 */
export function MapIntroPopup() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Deferred a tick: a synchronous setState in the effect body cascades
    // renders (react-hooks/set-state-in-effect) — the popup appears post-paint
    // either way, which reads as intentional.
    const t = setTimeout(() => {
      try {
        if (!window.localStorage.getItem(KEY)) setShow(true);
      } catch {
        // storage unavailable (private mode) — show once per session load
        setShow(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable — it will show again next visit; harmless */
    }
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-[rgba(11,8,41,.3)] p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="w-full max-w-[420px] rounded-[11px] border border-hairline bg-canvas p-6 shadow-pop"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mb-3 text-[15px] font-semibold text-ink">
              The map in three steps
            </div>
            <ol className="space-y-2.5">
              <Step n={1}>Click any parcel — or search an address / APN.</Step>
              <Step n={2}>
                Read its attributes and the instant viability score in the side
                panel.
              </Step>
              <Step n={3}>
                Hit <strong>Run diligence</strong> — RAI&apos;s agents do the
                full workup and open a report.
              </Step>
            </ol>
            <button
              type="button"
              onClick={dismiss}
              className="mt-5 w-full cursor-pointer rounded-full bg-oxford py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Got it
            </button>
            <p className="mt-2.5 text-center text-[11px] text-faint">
              Shown once — you won&apos;t see this again.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-[1.55] text-muted">
      <span className="mt-0.5 flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-ink">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
