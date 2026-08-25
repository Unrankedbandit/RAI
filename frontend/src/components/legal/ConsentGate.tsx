"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CONSENT_STORAGE_KEY,
  LEGAL_SECTIONS,
  LEGAL_TEMPLATE_NOTE,
} from "@/lib/legal";
import { clsx } from "@/lib/clsx";

type ConsentStatus = "pending" | "accepted" | "declined";

function readConsent(): boolean {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { accepted?: boolean; date?: string };
    return parsed.accepted === true && typeof parsed.date === "string";
  } catch {
    return false;
  }
}

/**
 * First-visit legal consent gate. Mounted in the root layout so it blocks
 * the start page AND any deep link: the overlay renders in the initial
 * "pending" state (including in SSR HTML), then useEffect checks
 * localStorage ("rai.legal.v1") and lifts the gate only on a recorded
 * acceptance. Declining swaps the panel to an explanation that the app
 * can't be used without accepting — the app stays dimmed, nothing is
 * stored, and the same dialog returns on the next visit. /legal pages
 * stay readable without consent so the full text is always reachable.
 */
export function ConsentGate() {
  const pathname = usePathname();
  // Mount-read without setState-in-effect (react-hooks/purity): the consent
  // snapshot comes from useSyncExternalStore — server snapshot "pending"
  // (gate hidden pre-hydration), client snapshot reads localStorage live.
  const accepted = useSyncExternalStore(
    () => () => {},
    () => readConsent(),
    () => false,
  );
  // "declined" is a session-only user gesture, so it stays a normal state;
  // only the persisted consent read needed the purity-safe store.
  const [declined, setDeclined] = useState(false);
  // Session acceptance lives in normal state too: the external store's
  // subscribe is a deliberate no-op, so after writing localStorage the store
  // alone would never re-read — and a same-value setDeclined(false) bails
  // out without a render, which made Accept look dead (user report).
  const [acceptedSession, setAcceptedSession] = useState(false);
  const status: ConsentStatus =
    accepted || acceptedSession ? "accepted" : declined ? "declined" : "pending";
  const [openSection, setOpenSection] = useState<string | null>(null);

  // Lock background scroll while the gate is up.
  useEffect(() => {
    if (status === "accepted") return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [status]);

  // Legal pages must be viewable without accepting (linked from the modal
  // and the footer).
  if (pathname.startsWith("/legal") || status === "accepted") return null;

  const accept = () => {
    try {
      localStorage.setItem(
        CONSENT_STORAGE_KEY,
        JSON.stringify({ accepted: true, date: new Date().toISOString() }),
      );
    } catch {
      // Storage unavailable — still let the session proceed; the gate will
      // reappear on the next visit.
    }
    setAcceptedSession(true); // lifts the gate THIS session (see above)
    setDeclined(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Legal terms and consent"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(11,8,41,.55)] p-4 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[88vh] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-[11px] bg-canvas shadow-pop">
        {status === "declined" ? (
          <div className="p-[24px]">
            <div className="text-[15px] font-semibold text-ink">
              We&apos;re sorry — you must agree to the terms to continue
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
              You declined the terms, and RAI can&apos;t be used without
              accepting them — the app will stay unavailable until you do.
              Nothing has been stored, and you&apos;ll be asked again on your
              next visit.
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              If you declined by mistake, you can review the terms again and
              accept.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeclined(false)}
                className="cursor-pointer rounded-[7px] border border-hairline bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink"
              >
                Review terms again
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-hairline p-[18px_20px]">
              <div className="text-[15px] font-semibold text-ink">
                Before you start
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                Please review and accept these terms to use RAI. Expand each
                section for the full text, or read them{" "}
                <Link
                  href="/legal"
                  className="underline underline-offset-2"
                  target="_blank"
                >
                  on one page
                </Link>
                .
              </p>
            </div>

            {/* Scrollable sections */}
            <div className="min-h-0 flex-1 overflow-y-auto p-[12px_20px]">
              {LEGAL_SECTIONS.map((section) => {
                const open = openSection === section.id;
                return (
                  <div
                    key={section.id}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSection(open ? null : section.id)
                      }
                      aria-expanded={open}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 py-[13px] text-left"
                    >
                      <span className="text-[13.5px] font-medium text-ink">
                        {section.title}
                      </span>
                      <span
                        aria-hidden
                        className={clsx(
                          "shrink-0 text-[13px] text-faint transition-transform",
                          open && "rotate-180",
                        )}
                      >
                        ▾
                      </span>
                    </button>
                    {open && (
                      <div className="pb-[14px]">
                        {section.body.map((para, i) => (
                          <p
                            key={i}
                            className="mt-1.5 text-[13px] leading-relaxed text-muted first:mt-0"
                          >
                            {para}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="py-3 text-[11.5px] text-faint">
                {LEGAL_TEMPLATE_NOTE}
              </p>
            </div>

            {/* Actions — no pre-checked boxes, both paths equally visible. */}
            <div className="flex flex-col-reverse gap-2 border-t border-hairline p-[16px_20px] sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setDeclined(true)}
                className="cursor-pointer rounded-[7px] border border-hairline bg-surface-2 px-4 py-2 text-[13px] font-medium text-muted"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={accept}
                className="cursor-pointer rounded-[7px] bg-ink px-4 py-2 text-[13px] font-semibold text-canvas"
              >
                Accept and continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
