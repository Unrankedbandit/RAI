/**
 * FROZEN CONTRACTS — do not edit without updating every implementation.
 * Every hotswappable component implements exactly one of these prop types
 * and is wired through src/registry.tsx. Builders: implement against these,
 * never change them. Orchestrator owns this file.
 */
import type React from "react";

export type Platform = "ios" | "android";

export type LayerId = "score" | "slope" | "flood" | "fire";

export type SheetState = "closed" | "peek" | "half" | "full";

export interface ParcelDrivers {
  /** 0..1 sub-scores that compose the total — shown in the detail sheet ("why"). */
  openSpace: number;
  buildingFreedom: number;
  acreageFit: number;
}

export interface Parcel {
  id: string;
  apn: string;
  county: string;
  address: string;
  /** Undefined = masked / not displayed by default (legal guidance, report 06). */
  owner?: string;
  acres: number;
  /** 0..100 solar-development probability. 0 = no-go, 100 = go. */
  score: number;
  zoning: string;
  /** ISO date the score was computed — rendered as "score as of" vintage stamp. */
  scoredAt: string;
  drivers: ParcelDrivers;
  /** SVG path data in the shared 1000x1000 mock-map coordinate space. */
  path: string;
}

/* ---------- slot prop contracts ---------- */

export interface MapSurfaceProps {
  parcels: Parcel[];
  activeLayer: LayerId;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export interface TopBarProps {
  platform: Platform;
  savedCount: number;
  onOpenSaved: () => void;
}

export interface SearchBarProps {
  platform: Platform;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export interface GradientLegendProps {
  collapsed: boolean;
  onToggle: () => void;
}

export interface ScorePillProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export interface LocateMeButtonProps {
  locating: boolean;
  onLocate: () => void;
}

export interface LayerSheetProps {
  open: boolean;
  active: LayerId;
  onPick: (layer: LayerId) => void;
  onClose: () => void;
  /** Render prop so the trigger button ships with the sheet implementation. */
  children?: React.ReactNode;
}

export interface ParcelSheetProps {
  platform: Platform;
  parcel: Parcel | null;
  state: SheetState;
  onStateChange: (s: SheetState) => void;
  saved: boolean;
  onToggleSave: () => void;
  /** Fires the discovery→diligence seam: create project from this parcel. */
  onRunDueDiligence: () => void;
}

export interface HandoffOverlayProps {
  platform: Platform;
  parcel: Parcel | null;
  open: boolean;
  onClose: () => void;
}

export interface SavedDrawerProps {
  open: boolean;
  saved: Parcel[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

export interface DeviceFrameProps {
  platform: Platform;
  label: string;
  children: React.ReactNode;
}

/* ---------- Mobile app screens (whole-app mobile version) ---------- */

/** Tab bar: 5 tabs, Ask in the center. Settings moved to a Home-header gear. */
export type MobileTab = "home" | "discover" | "ask" | "projects" | "findings";

/** Portfolio project, mobile shape. */
export interface MockProject {
  id: string;
  name: string;
  tech: string;
  location: string;
  capacityMW: number;
  /** 0..100 activation score. */
  score: number;
  band: "strong" | "watch" | "risk";
  statusLabel: string;
  /** Plain-English sentence beside the score. */
  scoreReason: string;
  /** Documents analyzed in the latest run. */
  documents: { name: string; pages: number }[];
}

export type MobileFindingStatus = "Open" | "In review" | "Resolved" | "Blocked";
export type MobileSeverity = "High" | "Medium" | "Low";

export interface MockFinding {
  id: string;
  projectId: string;
  project: string;
  title: string;
  workstream: string;
  severity: MobileSeverity;
  status: MobileFindingStatus;
  owner?: string;
  updatedAt: string;
  resolutionSummary: string;
  /** One-line cost of ignoring it. */
  impact: string;
  whyItMatters: string;
  recommendedAction: string;
  evidence?: { left: { value: string; source: string }; right: { value: string; source: string } };
}

/* Screen contracts — every screen is a slot in the registry. */
export interface HomeScreenProps {
  platform: Platform;
  projects: MockProject[];
  findings: MockFinding[];
  onOpenFindings: () => void;
  onOpenFinding: (id: string) => void;
  onStartProject: () => void;
  /** Gear icon in the header opens Settings as an overlay. */
  onOpenSettings: () => void;
}

export interface ProjectsScreenProps {
  platform: Platform;
  projects: MockProject[];
  /** Card tap — opens the project's detail overlay. */
  onOpenProject: (projectId: string) => void;
  /** Footer link — opens Findings filtered to this project. */
  onOpenProjectFindings: (projectId: string) => void;
  /** Per-project "add documents" — opens the scan flow for that project. */
  onAddDocuments: (projectId: string) => void;
}

export interface ProjectDetailScreenProps {
  platform: Platform;
  project: MockProject;
  /** Findings belonging to this project (already filtered by the shell). */
  findings: MockFinding[];
  onBack: () => void;
  onOpenFinding: (id: string) => void;
  onAddDocuments: (projectId: string) => void;
}

export interface AskScreenProps {
  platform: Platform;
  findings: MockFinding[];
  projects: MockProject[];
}

export interface FindingsScreenProps {
  platform: Platform;
  findings: MockFinding[];
  projectFilter: string | null;
  onClearFilter: () => void;
  onOpenFinding: (id: string) => void;
}

export interface FindingDetailScreenProps {
  platform: Platform;
  finding: MockFinding;
  onBack: () => void;
}

export interface SettingsScreenProps {
  platform: Platform;
}

export interface ScanScreenProps {
  platform: Platform;
  onClose: () => void;
}
