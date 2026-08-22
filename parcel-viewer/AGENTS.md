# parcel-mockup — RAI mobile parcel viewer design mockup

Browser-viewable mockup of the RAI mobile app (iOS + Android side-by-side).
Implements the design system and component contracts the production Expo/React
Native app will follow (see `../parcel-research/reports/04-mobile-stack-branding.md`).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gate: tsc + vite build must pass
```

## Architecture: hotswappable slots

- **`src/contracts/types.ts`** — FROZEN prop contracts + domain types. Never edit
  without updating every implementation in the same change.
- **`src/contracts/colors.ts`** — FROZEN red→green score ramp (`scoreColor`,
  `scoreVerdict`). Same stops as the production MapLibre `interpolate` style.
- **`src/registry.tsx`** — THE ONLY wiring file. Every UI element is a "slot"
  (`map`, `topBar`, `searchBar`, `legend`, `scorePill`, `locateMe`, `layerSheet`,
  `parcelSheet`, `savedDrawer`, `handoff`) mapped to a component. **Hotswap = change one line
  here.** The `Registry` type makes the compiler verify the swap satisfies the
  slot contract, so a bad swap fails at build time, never at runtime.
- **`src/screen/MapScreen.tsx`** — orchestrator-owned integration: owns ALL state,
  renders slots via the registry. Components are controlled (props in, callbacks
  out) and must not hold hidden global state or import sibling components
  directly (they may resolve siblings through `registry`).
- **`src/components/{map,chrome,sheet,stage}/`** — one component per file, each
  implementing exactly one slot contract. New variant of a component = new file +
  one-line registry change; keep the old file to swap back.

## Design rules (from RAI web brand)

- Tokens live in `src/theme.css` (`@theme`), ported verbatim from the web app's
  `globals.css`. Use token classes (`text-ink`, `bg-canvas`, `ring-hairline`,
  `bg-select`) — no hardcoded hex outside `contracts/colors.ts` ramp.
- Selection is a background fill (`--color-select`), never a border change.
- UI status palette avoids red/green (risk=orange `--color-risk`, cleared=grey
  `--color-strong`). The red→green ramp is map data-viz ONLY; keep brand orange
  out of the ramp. The detail sheet re-expresses the score with brand chips.
- Fonts: Poppins (UI), JetBrains Mono (numerals/scores/APNs).

## Ownership map (build swarm wave 1)

| Path | Owner |
|---|---|
| `src/data/mockParcels.ts`, `src/components/map/*` | Builder B1 |
| `src/components/chrome/*` | Builder B2 |
| `src/components/sheet/*` | Builder B3 |
| `src/components/stage/*` | Builder B4 |
| `src/components/seam/*` (discovery→diligence handoff) | orchestrator |
| `src/components/screens/HomeScreen.tsx` | Builder B1 |
| `src/components/screens/ProjectsScreen.tsx` | Builder B2 |
| `src/components/screens/FindingsScreen.tsx`, `FindingDetailScreen.tsx`, `screens/findings/*` | Builder B3 |
| `src/components/screens/SettingsScreen.tsx`, `ScanScreen.tsx`, `screens/settings/*`, `screens/scan/*` | Builder B4 |
| `src/shell/MobileAppShell.tsx` (tab nav + overlay stack) | orchestrator |
| everything else | orchestrator |

## Mobile app shell (waves 2–3)

`MobileAppShell` owns tab state (home/discover/ask/projects/findings — five
tabs, Ask centered) + overlay stack (finding detail, scan takeover, settings)
+ project→findings filter. Screens are registry slots (`home`, `projects`,
`findings`, `findingDetail`, `settings`, `scan`, `ask`) — same hotswap rule.
Discover tab renders the existing MapScreen. App.tsx goes full-screen app
(no frame) on narrow/phone viewports.

Wave 3 conventions: every screen's header is sticky (`sticky top-0 z-10
bg-canvas/95 backdrop-blur-sm`, `-mx-4 px-4` bleed idiom); settings opens as
an overlay from the Home gear; per-project "+ Docs" opens the scan flow.

Token note: `theme.css` defines no `-ink` variants (risk-ink etc.) — screens
use `text-risk`/`text-watch`/`text-strong` + `-soft` fills. Add real tokens
before reintroducing `-ink` classes.
