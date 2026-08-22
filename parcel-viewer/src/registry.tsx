/**
 * THE HOTSWAP POINT — one line per slot swaps an implementation app-wide.
 * Nothing else in the codebase imports components directly; everything
 * resolves through this registry, so a swap can never break wiring —
 * the slot's prop contract (src/contracts/types.ts) is enforced by the
 * compiler at this file's `Registry` type.
 */
import type React from "react";
import type * as T from "./contracts/types";

import { MapSurface } from "./components/map/MapSurface";
import { LayerSheet } from "./components/map/LayerSheet";
import { LocateMeButton } from "./components/map/LocateMeButton";
import { TopBar } from "./components/chrome/TopBar";
import { SearchBar } from "./components/chrome/SearchBar";
import { GradientLegend } from "./components/chrome/GradientLegend";
import { ScorePill } from "./components/chrome/ScorePill";
import { ParcelSheet } from "./components/sheet/ParcelSheet";
import { SavedDrawer } from "./components/sheet/SavedDrawer";
import { HandoffOverlay } from "./components/seam/HandoffOverlay";
import { HomeScreen } from "./components/screens/HomeScreen";
import { ProjectsScreen } from "./components/screens/ProjectsScreen";
import { FindingsScreen } from "./components/screens/FindingsScreen";
import { FindingDetailScreen } from "./components/screens/FindingDetailScreen";
import { SettingsScreen } from "./components/screens/SettingsScreen";
import { ScanScreen } from "./components/screens/ScanScreen";
import { AskScreen } from "./components/screens/AskScreen";
import { ProjectDetailScreen } from "./components/screens/ProjectDetailScreen";

export interface Registry {
  map: React.ComponentType<T.MapSurfaceProps>;
  topBar: React.ComponentType<T.TopBarProps>;
  searchBar: React.ComponentType<T.SearchBarProps>;
  legend: React.ComponentType<T.GradientLegendProps>;
  scorePill: React.ComponentType<T.ScorePillProps>;
  locateMe: React.ComponentType<T.LocateMeButtonProps>;
  layerSheet: React.ComponentType<T.LayerSheetProps>;
  parcelSheet: React.ComponentType<T.ParcelSheetProps>;
  savedDrawer: React.ComponentType<T.SavedDrawerProps>;
  handoff: React.ComponentType<T.HandoffOverlayProps>;
  home: React.ComponentType<T.HomeScreenProps>;
  projects: React.ComponentType<T.ProjectsScreenProps>;
  findings: React.ComponentType<T.FindingsScreenProps>;
  findingDetail: React.ComponentType<T.FindingDetailScreenProps>;
  settings: React.ComponentType<T.SettingsScreenProps>;
  scan: React.ComponentType<T.ScanScreenProps>;
  ask: React.ComponentType<T.AskScreenProps>;
  projectDetail: React.ComponentType<T.ProjectDetailScreenProps>;
}

export const registry: Registry = {
  map: MapSurface,
  topBar: TopBar,
  searchBar: SearchBar,
  legend: GradientLegend,
  scorePill: ScorePill,
  locateMe: LocateMeButton,
  layerSheet: LayerSheet,
  parcelSheet: ParcelSheet,
  savedDrawer: SavedDrawer,
  handoff: HandoffOverlay,
  home: HomeScreen,
  projects: ProjectsScreen,
  findings: FindingsScreen,
  findingDetail: FindingDetailScreen,
  settings: SettingsScreen,
  scan: ScanScreen,
  ask: AskScreen,
  projectDetail: ProjectDetailScreen,
};
