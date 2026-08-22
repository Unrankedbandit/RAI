"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const THEME_KEY = "rai-theme";
export const THEME_EVENT = "rai-theme-change";

/**
 * Theme primitives shared by ThemeToggle and the portfolio map.
 *
 * Contract (frozen with the layout bootstrap): `data-theme` lives on <html>,
 * is set pre-paint by the beforeInteractive script in app/layout.tsx, persists
 * to localStorage under 'rai-theme', and every change broadcasts a window
 * CustomEvent named 'rai-theme-change' with detail 'light' | 'dark'.
 */

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Persist + apply + broadcast a theme change. Call from event handlers only. */
export function applyTheme(next: Theme) {
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // private mode etc. — theme still applies for this session
  }
  document.documentElement.dataset.theme = next;
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
}

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    observer.disconnect();
  };
}

/**
 * Current theme, reactive to both applyTheme() broadcasts and direct
 * dataset flips. Server snapshot is 'light' — useSyncExternalStore resolves
 * the real value on the client without a hydration mismatch.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "light");
}
