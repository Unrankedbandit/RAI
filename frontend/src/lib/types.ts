// RAI data contract.
//
// Components consume these shapes as props — no data is hardcoded inside
// components. The backend swaps mock JSON for real Bedrock-agent output
// against this same contract without touching the UI layer.

export type RiskBand = "strong" | "watch" | "risk";

export type PillarName = "Land" | "Law" | "Finance" | "Materials" | "Demand";

export type StatusLabel = "Cleared" | "Watch" | "Flagged";

export type Factor = {
  id: string;
  name: string;
  band: RiskBand;
  statusLabel: StatusLabel;
  /** One-line, plain-English evidence sentence. */
  evidence: string;
  /** Source document titles this factor cites. */
  sources: string[];
  /** Present only for watch/risk factors — inline "Why this matters". */
  whyItMatters?: string;
  /** Present only for watch/risk factors — numbered recommended steps. */
  recommendedSteps?: string[];
  /** Id into the evidence map for the "View evidence" drawer (legacy). */
  evidenceId?: string;
};

export type PillarScore = {
  name: PillarName;
  score: number;
  band: RiskBand;
  /** "Unlocked" only when fully cleared — a genuine milestone, not a color. */
  unlocked: boolean;
  /** Status line under the bar, e.g. "Unlocked", "1 flag open", "1 in watch". */
  statusText: string;
  subAgents: string[];
  factors: Factor[];
};

export type Project = {
  id: string;
  name: string;
  location: string;
  /** Technology descriptor, e.g. "Solar" or "Solar + BESS". */
  tech?: string;
  capacityMW: number;
  latitude: number;
  longitude: number;
  activationScore: number;
  band: RiskBand;
  /** Short plain-English reasoning shown beside the score ring. */
  scoreReason: string;
  status: ProjectStatus;
  pillars: PillarScore[];
};

export type ProjectStatus = "on-track" | "needs-review" | "at-risk";

/** A single source card inside the evidence drawer. */
export type EvidenceSource = {
  title: string;
  location: string;
  highlight: string;
  extractedLabel: string;
  extractedValue: string;
};

/**
 * Evidence for one factor. A clean finding has a single source; a
 * cross-document contradiction has two sources plus a comparison table and a
 * qualitative confidence band (never a bare percentage).
 */
export type Evidence = {
  id: string;
  factorName: string;
  kind: "single" | "contradiction";
  summary: string;
  confidence: "High confidence" | "Medium confidence" | "Needs review";
  sources: EvidenceSource[];
  comparison?: {
    dimension: string;
    rows: { label: string; a: string; b: string }[];
  };
};

export type TimelineEvent = {
  id: string;
  label: string;
  /** Short position label under the dot, e.g. "Construction (Oct)". */
  shortLabel?: string;
  /** ISO date string. */
  date: string;
  /** Human date shown in the tooltip, e.g. "Oct 14, 2026 (scheduled)". */
  dateDisplay?: string;
  /** Tooltip body copy. */
  description?: string;
  /** Note appended in the tooltip conflict line. */
  conflictNote?: string;
  band: RiskBand;
  /** Percentage position along the track (0–100) — matches the mockup. */
  position: number;
  /** Shared key: two events with the same key cross-highlight together. */
  conflictKey?: string;
  kind?: "milestone" | "deadline";
};

export type MapZone = {
  id: string;
  type: "suitable" | "restricted";
  title: string;
  description: string;
  source: string;
  /** Percentage-based bounds, matching the mockup. */
  bounds: { left: number; top: number; width: number; height: number };
};

export type MapToggle = {
  id: string;
  label: string;
  on: boolean;
};

export type MapDistance = { label: string; value: string };

export type TeamMember = {
  name: string;
  email: string;
  access: "full" | "limited";
};

export type ChatAction = {
  name: string;
  impact: "high" | "medium";
  evidenceLink?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
};

/** A scripted suggested-question → answer pair for the RAI assistant. */
export type ScriptedQA = {
  question: string;
  answer: ChatMessage;
};

export type PriorityAction = {
  id: string;
  rank: number;
  title: string;
  detail: string;
  impact: "high" | "medium";
  evidenceLink?: string;
  scoreDelta: number;
};

export type ProjectDocument = {
  id: string;
  title: string;
  kind: string;
  /** File size label, e.g. "2.1 MB" (matches the reference documents list). */
  size?: string;
  pages?: number;
  uploadedAt?: string;
  /** Which pillar(s) this document primarily informs. */
  pillars: PillarName[];
};

export type RecentDocument = {
  title: string;
  project: string;
  status: "Analyzed" | "Scanning" | "Queued";
  addedAt: string;
};

/** A row in the Home "recent activity" table — a project or a document. */
export type RecentActivity = {
  name: string;
  kind: "Project" | "Document";
  /** Present for project rows — drives the status pill. */
  status?: ProjectStatus;
  /** Present for document rows — the project it belongs to. */
  project?: string;
  time: string;
};

export type ReportContent = {
  badge: string;
  title: string;
  preparedBy: string;
  summary: string;
  findings: { title: string; text: string }[];
  /** Recommended action lines (may contain a "— projected +N pts" suffix). */
  recommendedActions: string[];
  sourceBasis: string;
};

export type MapData = {
  parcelSize: string;
  toggles: MapToggle[];
  distances: MapDistance[];
  zones: MapZone[];
  pin: { left: number; top: number; label: string };
};

/** Everything the Project view and its tabs need, keyed by project id. */
export type ProjectDetail = {
  project: Project;
  /** Header eyebrow, e.g. "Solar · 180 MW · West Texas". */
  eyebrow: string;
  /** Header sub, e.g. "7 documents + 3 sheets analyzed · run #A-1147". */
  runSummary: string;
  scoreBandLabel: string;
  scoreNote: string;
  evidence: Record<string, Evidence>;
  timeline: TimelineEvent[];
  documents: ProjectDocument[];
  priorityActions: PriorityAction[];
  projectedScoreAfterMitigation: number;
  suggestedQuestions: ScriptedQA[];
  chatHistory: ChatMessage[];
  report: ReportContent;
  map: MapData;
  teamMembers: TeamMember[];
};

/** One of the five risk factors, for the portfolio legend. */
export type RiskFactorDefinition = {
  name: PillarName;
  definition: string;
};
