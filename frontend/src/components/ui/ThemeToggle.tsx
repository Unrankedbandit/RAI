"use client";

import { useEffect, useState, type ComponentType } from "react";

type Theme = "light" | "dark";

const THEME_KEY = "rai-theme";
const THEME_EVENT = "rai-theme-change";

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const OPTIONS: { value: Theme; label: string; Icon: ComponentType }[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/**
 * Segmented Light | Dark switch (two explicit options — no "system" mode).
 *
 * On select: persists to localStorage ('rai-theme'), sets
 * document.documentElement.dataset.theme, and broadcasts
 * window event 'rai-theme-change' with detail 'light' | 'dark' — the
 * portfolio map listens for this event (frozen cross-builder contract).
 *
 * The active option is only known after mount: state initialises from
 * <html data-theme> in useEffect (the attribute is set pre-paint by the
 * beforeInteractive script in layout.tsx). SSR and the first client render
 * both paint the pill with no active option, so there is no hydration
 * mismatch.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  }, []);

  function select(next: Theme) {
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  }

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex items-center rounded-full border border-hairline bg-surface-2 p-[3px]"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => select(value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-[5px] text-[12px] font-medium transition-colors ${
              active ? "bg-oxford text-white" : "text-muted hover:text-ink"
            }`}
          >
            <Icon />
            {label}
          </button>
        );
      })}
    </div>
  );
}
