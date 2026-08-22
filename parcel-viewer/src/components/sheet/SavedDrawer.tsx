import { registry } from "../../registry";
import type { SavedDrawerProps } from "../../contracts/types";

export function SavedDrawer({ open, saved, onClose, onSelect }: SavedDrawerProps) {
  const ScorePill = registry.scorePill;

  return (
    <div
      aria-hidden={!open}
      className={`absolute inset-0 z-50 flex flex-col bg-canvas transition-transform duration-300 ease-out ${
        open ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="text-base font-semibold text-ink">Saved parcels</h2>
        <button
          onClick={onClose}
          tabIndex={open ? 0 : -1}
          className="rounded-full px-3 py-3 text-sm text-muted active:bg-select"
        >
          ← Map
        </button>
      </header>

      {saved.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-faint">
          No saved parcels yet — tap a parcel and hit Save.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {saved.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onSelect(p.id)}
                tabIndex={open ? 0 : -1}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-select active:bg-select"
              >
                <ScorePill score={p.score} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">
                    {p.address}
                  </div>
                  <div className="text-xs text-muted">
                    <span className="font-jetbrains">{p.apn}</span> ·{" "}
                    <span className="font-jetbrains">{p.acres}</span> ac
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
