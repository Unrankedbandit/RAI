/**
 * FROZEN — slot names. The registry (src/registry.tsx) maps each slot to the
 * active component. Hotswapping = point one slot at a different implementation.
 */
export const SLOT_NAMES = [
  "map",
  "topBar",
  "searchBar",
  "legend",
  "scorePill",
  "locateMe",
  "layerSheet",
  "parcelSheet",
  "savedDrawer",
  "handoff",
  "home",
  "projects",
  "findings",
  "findingDetail",
  "settings",
  "scan",
  "ask",
  "projectDetail",
] as const;

export type SlotName = (typeof SLOT_NAMES)[number];
