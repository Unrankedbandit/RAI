"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Subtle install nudge. Two modes:
 *  - Chromium/Android/desktop: appears once `beforeinstallprompt` fires and
 *    triggers the native prompt from its "Install" button.
 *  - iOS Safari (no beforeinstallprompt): a one-time hint —
 *    "Share → Add to Home Screen".
 *
 * Hidden when already installed (standalone) or previously dismissed;
 * dismissal persists in localStorage ("rai.install.dismissed.v1"). Styled
 * after ui/OfflineBanner (status dot + hairline card, 11px radius).
 */

const DISMISS_KEY = "rai.install.dismissed.v1";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIOS && isSafari;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // Session-only hide, so dismissing re-renders without re-reading storage.
  const [hidden, setHidden] = useState(false);
  // Purity-safe mount read (same pattern as legal/ConsentGate): the iOS hint
  // depends on navigator/localStorage, so it comes from useSyncExternalStore —
  // server snapshot "false" (chip absent from SSR HTML), client snapshot live.
  const showIOSHint = useSyncExternalStore(
    () => () => {},
    () => !isStandalone() && !wasDismissed() && isIOSSafari(),
    () => false,
  );

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // Storage unavailable — chip simply won't persist dismissal.
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    // iOS Safari never fires beforeinstallprompt — the store shows the hint.

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDeferred(null);
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") dismiss();
    } catch {
      // Prompt failed — leave the chip up; the browser UI remains available.
    }
    setDeferred(null);
  };

  if (hidden || (!deferred && !showIOSHint)) return null;

  return (
    <div
      role="status"
      className="fixed bottom-10 right-4 z-[150] flex max-w-[320px] items-center gap-2.5 rounded-[11px] border border-hairline bg-canvas px-3.5 py-2.5 shadow-pop"
    >
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] flex-none rounded-full"
        style={{ backgroundColor: "var(--color-brand)" }}
      />
      {deferred ? (
        <>
          <span className="text-[12.5px] font-medium text-ink">
            Install RAI for quick access
          </span>
          <button
            type="button"
            onClick={install}
            className="flex-none cursor-pointer rounded-[7px] bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-canvas"
          >
            Install
          </button>
        </>
      ) : (
        <span className="text-[12.5px] font-medium text-ink">
          Install RAI: tap Share, then &ldquo;Add to Home Screen&rdquo;
        </span>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="flex-none cursor-pointer px-1 text-[14px] leading-none text-faint hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
