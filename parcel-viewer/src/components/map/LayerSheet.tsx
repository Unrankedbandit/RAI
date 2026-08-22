import type { LayerId, LayerSheetProps } from "../../contracts/types";
import { scoreColor } from "../../contracts/colors";

/**
 * Modal bottom sheet for map layers. Scrim taps and the close affordance fire
 * onClose; row taps fire onPick. Active row = bg-select FILL (brand rule:
 * selection is never a border change). Non-score layers are mock previews and
 * carry a "Preview" chip. Stays mounted while closed so the slide-up /
 * slide-down transition animates both ways.
 */

const LAYERS: Array<{ id: LayerId; name: string; desc: string; preview: boolean }> = [
  { id: "score", name: "Solar score", desc: "Development probability — red no-go to green go", preview: false },
  { id: "slope", name: "Slope", desc: "Terrain steepness, percent grade", preview: true },
  { id: "flood", name: "Flood", desc: "FEMA 100-year flood zones", preview: true },
  { id: "fire", name: "Fire", desc: "Wildfire hazard severity zones", preview: true },
];

function Swatch({ id }: { id: LayerId }) {
  if (id === "score") {
    return (
      <span
        aria-hidden
        className="h-9 w-9 shrink-0 rounded-lg ring-1 ring-hairline"
        style={{
          background: `linear-gradient(135deg, ${scoreColor(0)}, ${scoreColor(50)}, ${scoreColor(100)})`,
        }}
      />
    );
  }
  const fill = id === "slope" ? "bg-vista" : id === "flood" ? "bg-vista-soft" : "bg-amande";
  return <span aria-hidden className={`h-9 w-9 shrink-0 rounded-lg ring-1 ring-hairline ${fill}`} />;
}

export function LayerSheet({ open, active, onPick, onClose, children }: LayerSheetProps) {
  return (
    <>
      {children}
      <div className={`absolute inset-0 z-30 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        {/* scrim — tap to close */}
        <button
          type="button"
          aria-label="Close layers"
          tabIndex={open ? 0 : -1}
          onClick={onClose}
          className={`absolute inset-0 bg-ink/35 transition-opacity duration-300 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* sheet */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Map layers"
          className={`absolute inset-x-0 bottom-0 rounded-t-3xl bg-canvas px-4 pb-6 pt-2 shadow-2xl transition-transform duration-300 ease-out ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-hairline" />
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Map layers</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              tabIndex={open ? 0 : -1}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-xs text-muted"
            >
              <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                tabIndex={open ? 0 : -1}
                aria-pressed={active === l.id}
                onClick={() => onPick(l.id)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                  active === l.id ? "bg-select" : "bg-canvas active:bg-surface-2"
                }`}
              >
                <Swatch id={l.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{l.name}</span>
                  <span className="block truncate text-xs text-muted">{l.desc}</span>
                </span>
                {l.preview && (
                  <span className="rounded-full bg-vista-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vista">
                    Preview
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
