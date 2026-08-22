/**
 * ORCHESTRATOR-OWNED integration point. All state lives here; every rendered
 * element resolves through the registry. No component imports another
 * component directly — that is what makes hotswapping breakage-proof.
 */
import { useMemo, useState } from "react";
import { registry } from "../registry";
import { mockParcels } from "../data/mockParcels";
import type { LayerId, Platform, SheetState } from "../contracts/types";

export function MapScreen({ platform }: { platform: Platform }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("closed");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [activeLayer, setActiveLayer] = useState<LayerId>("score");
  const [search, setSearch] = useState("");
  const [layerSheetOpen, setLayerSheetOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(true);

  const parcels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mockParcels;
    return mockParcels.filter((p) =>
      [p.apn, p.county, p.address, p.owner ?? "", p.zoning]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [search]);

  const selected = mockParcels.find((p) => p.id === selectedId) ?? null;
  const saved = mockParcels.filter((p) => savedIds.includes(p.id));

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setSheetState("peek");
    setSavedOpen(false);
  };
  const toggleSave = () => {
    if (!selected) return;
    setSavedIds((ids) =>
      ids.includes(selected.id) ? ids.filter((i) => i !== selected.id) : [...ids, selected.id],
    );
  };
  const locate = () => {
    setLocating(true);
    window.setTimeout(() => setLocating(false), 1200);
  };

  const Map = registry.map;
  const TopBar = registry.topBar;
  const Search = registry.searchBar;
  const Legend = registry.legend;
  const LocateMe = registry.locateMe;
  const Layers = registry.layerSheet;
  const Sheet = registry.parcelSheet;
  const Drawer = registry.savedDrawer;
  const Handoff = registry.handoff;

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {/* base layer */}
      <div className="absolute inset-0">
        <Map parcels={parcels} activeLayer={activeLayer} selectedId={selectedId} onSelect={handleSelect} />
      </div>

      {/* top chrome */}
      <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-canvas/95 to-transparent pb-4">
        <TopBar platform={platform} savedCount={savedIds.length} onOpenSaved={() => setSavedOpen(true)} />
        <div className="px-3">
          <Search platform={platform} value={search} onChange={setSearch} />
        </div>
      </div>

      {/* left rail */}
      <div className="absolute bottom-28 left-3 z-20">
        <Legend collapsed={legendCollapsed} onToggle={() => setLegendCollapsed((c) => !c)} />
      </div>

      {/* right rail */}
      <div className="absolute bottom-28 right-3 z-20 flex flex-col gap-2">
        <LocateMe locating={locating} onLocate={locate} />
      </div>

      <Layers
        open={layerSheetOpen}
        active={activeLayer}
        onPick={(l) => {
          setActiveLayer(l);
          setLayerSheetOpen(false);
        }}
        onClose={() => setLayerSheetOpen(false)}
      >
        {/* trigger ships with the sheet implementation — sits above the right rail */}
        <button
          type="button"
          onClick={() => setLayerSheetOpen(true)}
          aria-label="Layers"
          className="absolute bottom-[164px] right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-canvas text-ink shadow-md ring-1 ring-hairline"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m12 2 9 5-9 5-9-5 9-5z" />
            <path d="m3 12 9 5 9-5" />
            <path d="m3 17 9 5 9-5" />
          </svg>
        </button>
      </Layers>

      <Sheet
        platform={platform}
        parcel={selected}
        state={sheetState}
        onStateChange={setSheetState}
        saved={selected ? savedIds.includes(selected.id) : false}
        onToggleSave={toggleSave}
        onRunDueDiligence={() => {
          setSheetState("closed");
          setHandoffOpen(true);
        }}
      />

      <Handoff
        platform={platform}
        parcel={selected}
        open={handoffOpen}
        onClose={() => setHandoffOpen(false)}
      />

      <Drawer
        open={savedOpen}
        saved={saved}
        onClose={() => setSavedOpen(false)}
        onSelect={(id) => {
          setSavedOpen(false);
          handleSelect(id);
        }}
      />
    </div>
  );
}
