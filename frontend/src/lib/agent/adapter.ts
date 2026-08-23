// TypeScript port of agent_backend/sentinel_adapter.py.
// Converts a Red Flag agent report into a COMPLETE Solar Sentinel
// ProjectDetail (src/lib/types.ts) — pillars, factors, evidence (incl.
// contradiction comparison tables), timeline, documents, priority actions,
// suggested questions and chat history.
//
// Parity-tested against the Python adapter: scripts/test-adapter-parity.mjs
// asserts byte-identical output on every fixture in agent_backend/reports/.

import type {
  Evidence,
  EvidenceSource,
  Factor,
  PillarName,
  PillarScore,
  PriorityAction,
  Project,
  ProjectDetail,
  RiskBand,
  StatusLabel,
  TimelineEvent,
} from "../types";
import type { PortfolioRow } from "./client";
import { slugify } from "./liveStore.ts";
import type { AgentReport } from "./report";
const ITC_DEADLINE = "2030-12-31";

const COMPONENT_TO_PILLAR: Record<string, PillarName> = {
  land: "Land", zoning: "Land", permitting: "Land", community: "Land",
  land_use: "Land", resource: "Land", resource_supply_chain: "Land",
  resite: "Land",
  state_law: "Law", federal_law: "Law", law: "Law", ecology_epa: "Law",
  ecology: "Law", epa: "Law",
  financials: "Finance", finance: "Finance",
  materials: "Materials", supply_chain: "Materials",
  demand: "Demand", buyers: "Demand", grid_integration: "Demand",
  grid: "Demand", interconnection: "Demand",
};

const PILLARS: PillarName[] = ["Land", "Law", "Finance", "Materials", "Demand"];

const PILLAR_AGENTS: Record<PillarName, string[]> = {
  Land: ["extractor:land-docs", "scout:zoning", "researcher:land_use"],
  Law: ["researcher:state_law", "researcher:federal_law", "researcher:ecology_epa"],
  Finance: ["researcher:financials", "cross-examiner"],
  Materials: ["researcher:supply_chain"],
  Demand: ["researcher:demand", "researcher:interconnection"],
};

const DOC_KIND: [string, string, PillarName[]][] = [
  ["land", "Land report", ["Land"]],
  ["environmental", "Environmental assessment", ["Land", "Law"]],
  ["legal", "Legal memo", ["Law"]],
  ["community", "Stakeholder report", ["Law", "Demand"]],
  ["materials", "Materials & price index", ["Materials", "Demand"]],
  ["financial", "Financial memo", ["Finance"]],
  ["sensitivity", "Financial model", ["Finance", "Demand"]],
  ["tracker", "Materials & demand tracker", ["Materials", "Demand"]],
  ["register", "Risk register", PILLARS],
  ["site_comparison", "Screening memorandum", PILLARS],
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "are",
  "not", "has", "have", "will", "our", "their", "its", "per", "via",
]);

export interface SentinelMeta {
  id: string;
  latitude?: number;
  longitude?: number;
  capacityMW?: number;
  uploadedAt?: string; // ISO date, defaults to hackathon day
}

export function band(score: number): RiskBand {
  return score >= 70 ? "strong" : score >= 40 ? "watch" : "risk";
}

function status(decision: string): "on-track" | "needs-review" | "at-risk" {
  const d = decision.toLowerCase();
  if (d.includes("proceed")) return "on-track";
  if (d.includes("investigate")) return "needs-review";
  return "at-risk";
}

function sevBand(severity: string): [RiskBand, StatusLabel] {
  return severity === "critical" || severity === "high"
    ? ["risk", "Flagged"]
    : ["watch", "Watch"];
}

/** Pillar status line under the bar (matches frontend reference copy). */
function statusTextFor(score: number, factors: Factor[]): string {
  if (score >= 70) return "Unlocked";
  const nRisk = factors.filter((f) => f.band === "risk").length;
  if (nRisk > 0) return `${nRisk} flag${nRisk > 1 ? "s" : ""} open`;
  const nWatch = factors.filter((f) => f.band === "watch").length;
  return `${nWatch} in watch`;
}

/** First capacity mention in a project name ("… 180 MWac …" → 180), else 0. */
function capacityFromName(name: string): number {
  const m = /(\d+(?:\.\d+)?)\s*MW/i.exec(name);
  return m ? Number.parseFloat(m[1]) : 0;
}

/**
 * Convert one GET /api/projects row into the Project view model the
 * portfolio pages render. Band comes from the readiness score, status from
 * the decision string — the same split toSentinel uses for full reports, so
 * a list row and its detail page never disagree. Rows carry no coordinates
 * today: latitude/longitude are zeroed and callers must suppress map pins
 * (the researched-parcel layer in ./researched owns live map dots).
 */
export function toPortfolioProject(row: PortfolioRow): Project {
  const readiness = Math.round(row.readiness);
  const b = band(readiness);
  const dims = new Map(
    (row.dimensions ?? []).map((d) => [d.name.trim().toLowerCase(), d]),
  );
  const pillars: PillarScore[] = PILLARS.map((name) => {
    const dim = dims.get(name.toLowerCase());
    const score = Math.round(dim?.score ?? 0);
    const pb = band(score);
    const factors: Factor[] = (dim?.flags ?? []).map((text, i) => ({
      id: `${name.toLowerCase()}-flag-${i}`,
      name: text.slice(0, 90),
      band: pb,
      statusLabel:
        pb === "strong" ? "Cleared" : pb === "watch" ? "Watch" : "Flagged",
      evidence: text,
      sources: [],
    }));
    return {
      name,
      score,
      band: pb,
      unlocked: score >= 70,
      statusText: statusTextFor(score, factors),
      subAgents: PILLAR_AGENTS[name],
      factors,
    };
  });
  return {
    id: row.id ?? slugify(row.project),
    name: row.project,
    location: row.location,
    capacityMW: capacityFromName(row.project),
    latitude: 0,
    longitude: 0,
    activationScore: readiness,
    band: b,
    scoreReason: `Decision: ${row.decision}`,
    status: status(row.decision),
    pillars,
  };
}

function pillarFor(component: string): PillarName {
  const key = component.toLowerCase().replace(/ /g, "_").replace(/\//g, "_").replace(/&/g, "").replace(/^_+|_+$/g, "");
  return COMPONENT_TO_PILLAR[key] ?? "Land";
}

function docEntry(id: string, title: string, uploaded: string) {
  const low = title.toLowerCase();
  const match = DOC_KIND.find(([k]) => low.includes(k));
  const [, kind, pillars] = match ?? ["", "Diligence document", PILLARS];
  return { id, title, kind, pages: 0, uploadedAt: uploaded, pillars };
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function linkEvidence(text: string, evidence: Record<string, Evidence>): string | undefined {
  const tw = words(text);
  let best: string | undefined;
  let bestScore = 0;
  for (const [evId, ev] of Object.entries(evidence)) {
    let score = 0;
    for (const w of words(ev.summary)) if (tw.has(w)) score++;
    if (score > bestScore) {
      best = evId;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : undefined;
}

function isoFrom(text: string | null): string | undefined {
  if (!text) return undefined;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m1 = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/.exec(text);
  if (m1) {
    const month = months.indexOf(m1[1].toLowerCase().slice(0, 3)) + 1;
    return `${m1[2]}-${String(month).padStart(2, "0")}-01`;
  }
  const m2 = /Q([1-4])\s*(\d{4})/.exec(text);
  if (m2) return `${m2[2]}-${String(Number(m2[1]) * 3 - 2).padStart(2, "0")}-01`;
  return undefined;
}

// Timeline-entry severity -> marker band: dated deal-killers read red, secured
// items read green. Keep in lockstep with agent_backend/sentinel_adapter.py.
const SEV_TO_BAND: Record<string, RiskBand> = {
  critical: "risk",
  high: "risk",
  medium: "watch",
  low: "strong",
};

/** "2026-08-03" -> "Aug 3, 2026" (mockData's tooltip date format). */
function dateDisplay(iso: string): string {
  const [y, m, d] = iso.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${mon} ${Number(d)}, ${y}`;
}

/** Convert one agent report into a complete Solar Sentinel ProjectDetail. */
export function toSentinel(report: AgentReport, meta: SentinelMeta): ProjectDetail {
  // Dimension names arrive in whatever case the model felt like ("land" vs
  // "Land") — normalize for lookup or pillars silently zero out.
  const dims = new Map(report.dimensions.map((d) => [d.name.trim().toLowerCase(), d]));
  const evidence: Record<string, Evidence> = {};
  const pillars: PillarScore[] = [];

  for (const name of PILLARS) {
    const dim = dims.get(name.toLowerCase());
    const score = dim?.score ?? 0;
    const factors: Factor[] = [];

    for (const [i, text] of (dim?.flags ?? []).entries()) {
      const b = band(score);
      factors.push({
        id: `${name.toLowerCase()}-flag-${i}`,
        name: text.slice(0, 90),
        band: b,
        statusLabel: b === "strong" ? "Cleared" : b === "watch" ? "Watch" : "Flagged",
        evidence: text,
        sources: [],
      });
    }

    for (const rf of report.red_flags) {
      if (pillarFor(rf.component) !== name) continue;
      const [b, label] = sevBand(rf.severity);
      const evId = `ev-${name.toLowerCase()}-${Object.keys(evidence).length}`;
      factors.push({
        id: evId,
        name: rf.title.slice(0, 90),
        band: b,
        statusLabel: label,
        evidence: rf.evidence,
        sources: rf.sources,
        evidenceId: evId,
      });
      const srcNames = rf.sources.length ? rf.sources : [rf.component];
      evidence[evId] = {
        id: evId,
        factorName: rf.title.slice(0, 90),
        kind: "single",
        summary: rf.evidence,
        confidence: rf.benchmark ? "High confidence" : "Medium confidence",
        sources: srcNames.map((s): EvidenceSource => ({
          title: s || rf.component,
          location: rf.component,
          highlight: rf.evidence,
          extractedLabel: rf.component,
          extractedValue: rf.benchmark ?? "",
        })),
      };
    }

    pillars.push({
      name,
      score,
      band: band(score),
      unlocked: score >= 70,
      statusText: statusTextFor(score, factors),
      subAgents: PILLAR_AGENTS[name],
      factors,
    });
  }

  for (const [i, c] of report.contradictions.entries()) {
    const evId = `ev-contradiction-${i}`;
    const pairCount = Math.min(c.sources.length, c.claims.length);
    const sources: EvidenceSource[] = pairCount
      ? Array.from({ length: pairCount }, (_, j) => ({
          title: c.sources[j],
          location: "cross-document check",
          highlight: c.claims[j],
          extractedLabel: "claim",
          extractedValue: c.claims[j],
        }))
      : [{
          title: "agent cross-examination",
          location: "",
          highlight: c.explanation,
          extractedLabel: "",
          extractedValue: "",
        }];
    const rows = Array.from({ length: pairCount }, (_, j) => ({
      label: c.sources[j],
      a: c.claims[j],
      b: "",
    }));
    if (rows.length >= 2) rows.push({ label: "Conflict", a: "", b: "contradictory" });
    evidence[evId] = {
      id: evId,
      factorName: `Contradiction: ${c.explanation.slice(0, 60)}`,
      kind: "contradiction",
      summary: c.explanation,
      confidence: c.severity === "critical" || c.severity === "high" ? "High confidence" : "Needs review",
      sources,
      comparison: { dimension: c.explanation.slice(0, 60), rows },
    };
  }

  // Timeline: the agent-emitted critical path wins when present (full strip
  // elements: shortLabel, dateDisplay, description, per-event band); the
  // agency-action deadline parse is the fallback for pre-contract reports.
  const rawTimeline: {
    label: string;
    date: string;
    kind: "milestone" | "deadline";
    shortLabel?: string;
    dateDisplay?: string;
    description?: string;
    band?: RiskBand;
  }[] = [];
  for (const t of report.action_pack.timeline ?? []) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") ? t.date : isoFrom(t.date);
    if (iso) {
      const entry: (typeof rawTimeline)[number] = {
        label: t.label.slice(0, 80),
        date: iso,
        kind: t.kind,
        shortLabel: t.label.slice(0, 26),
        dateDisplay: dateDisplay(iso),
        band: SEV_TO_BAND[t.severity] ?? "watch",
      };
      if (t.detail) entry.description = t.detail;
      rawTimeline.push(entry);
    }
  }
  if (rawTimeline.length === 0) {
    for (const a of report.action_pack.agency_actions) {
      const iso = isoFrom(a.deadline);
      if (iso) rawTimeline.push({ label: `${a.agency} — ${a.action}`.slice(0, 80), date: iso, kind: "milestone" });
    }
  }
  rawTimeline.push({ label: "ITC deadline", date: ITC_DEADLINE, kind: "deadline" });
  rawTimeline.sort((x, y) => x.date.localeCompare(y.date));

  const b = band(report.readiness);
  const times = rawTimeline.map((e) => Date.parse(e.date));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const timeline: TimelineEvent[] = rawTimeline.map((e, i) => {
    const ev: TimelineEvent = {
      id: `tl-${i}`,
      label: e.label,
      date: e.date,
      kind: e.kind,
      band: e.band ?? b,
      position: maxT === minT ? 50 : Math.round(((Date.parse(e.date) - minT) / (maxT - minT)) * 1000) / 10,
    };
    if (e.shortLabel !== undefined) ev.shortLabel = e.shortLabel;
    if (e.dateDisplay !== undefined) ev.dateDisplay = e.dateDisplay;
    if (e.description !== undefined) ev.description = e.description;
    return ev;
  });

  const seen = new Map<string, ReturnType<typeof docEntry>>();
  const allSources = [
    ...report.red_flags.flatMap((r) => r.sources),
    ...report.contradictions.flatMap((c) => c.sources),
  ];
  for (const s of allSources) {
    if (/\.(pdf|xlsx)$/i.test(s) && !seen.has(s)) {
      seen.set(s, docEntry(`doc-${String(seen.size + 1).padStart(2, "0")}`, s, meta.uploadedAt ?? "2026-08-14"));
    }
  }

  const priorityActions: PriorityAction[] = [];
  const cps = report.action_pack.conditions_precedent;
  cps.forEach((cp, i) => {
    const action: PriorityAction = {
      id: `pa-${i + 1}`,
      rank: i + 1,
      title: cp.slice(0, 90),
      detail: cp,
      impact: "high",
      scoreDelta: 6,
    };
    const link = linkEvidence(cp, evidence);
    if (link) action.evidenceLink = link;
    priorityActions.push(action);
  });
  report.action_pack.rfis.slice(0, 3).forEach((rfi, i) => {
    const action: PriorityAction = {
      id: `pa-${cps.length + i + 1}`,
      rank: cps.length + i + 1,
      title: rfi.slice(0, 90),
      detail: rfi,
      impact: "medium",
      scoreDelta: 3,
    };
    const link = linkEvidence(rfi, evidence);
    if (link) action.evidenceLink = link;
    priorityActions.push(action);
  });

  const projected = Math.min(100, report.readiness + (b === "strong" ? 6 : b === "watch" ? 18 : 28));
  const crit = report.red_flags.filter((f) => f.severity === "critical").length;
  const weakest = [...report.dimensions].sort((x, y) => x.score - y.score).slice(0, 2);

  return {
    project: {
      id: meta.id,
      name: report.project,
      location: report.location,
      capacityMW: meta.capacityMW ?? 0,
      latitude: meta.latitude ?? 0,
      longitude: meta.longitude ?? 0,
      activationScore: report.readiness,
      band: b,
      scoreReason: report.recommended_next_action ?? "",
      status: status(report.decision),
      pillars,
    },
    eyebrow: `Solar · ${meta.capacityMW ?? 0} MW · ${report.location}`,
    runSummary: `${seen.size} documents analyzed · ${report.missing_info.length} open items`,
    scoreBandLabel: `${b.charAt(0).toUpperCase() + b.slice(1)} · ${Math.round(report.readiness)}/100`,
    scoreNote: report.recommended_next_action ?? "",
    evidence,
    timeline,
    documents: [...seen.values()],
    priorityActions,
    projectedScoreAfterMitigation: projected,
    suggestedQuestions: [
      {
        question: "What's the top item to clear next?",
        answer: {
          role: "assistant",
          text: report.recommended_next_action
            ?? `Clear the ${crit} critical red flags, starting with the lowest-scoring pillar.`,
        },
      },
      {
        question: `Why is the activation score ${Math.round(report.readiness)}?`,
        answer: {
          role: "assistant",
          text: `${crit} critical red flags and ${report.contradictions.length} cross-document contradictions. Weakest pillars: ${weakest.map((d) => `${d.name} ${Math.round(d.score)}`).join(", ")}.`,
        },
      },
    ],
    chatHistory: [
      {
        role: "assistant",
        text: `I've completed diligence on ${report.project}. Activation score ${Math.round(report.readiness)}/100 — decision: ${report.decision}. ${crit} critical flags, ${report.contradictions.length} cross-document contradictions, ${report.missing_info.length} open information requests. Ask me what to prioritize.`,
      },
    ],
    report: {
      badge: "RED FLAG REPORT",
      title: `${report.project} — due-diligence report`,
      preparedBy: "Red Flag agent framework",
      summary: report.recommended_next_action ?? "",
      findings: report.red_flags.slice(0, 5).map((rf) => ({
        title: rf.title.slice(0, 90),
        text: rf.evidence,
      })),
      recommendedActions: report.action_pack.conditions_precedent.slice(0, 5),
      sourceBasis: `${seen.size} source documents + ${report.acquired_data.length} acquired research packs`,
    },
    // Conditional key: the parity harness uses strict deepEqual against the
    // Python adapter — emit acquiredData only when non-empty, in lockstep.
    ...(report.acquired_data.length
      ? {
          acquiredData: report.acquired_data.map((a) => ({
            component: a.component,
            dataPoints: a.data_points,
            sources: a.sources,
            stillMissing: a.still_missing,
          })),
        }
      : {}),
    map: {
      parcelSize: "—",
      toggles: [
        { id: "zoning", label: "Zoning", on: true },
        { id: "protected-land", label: "Protected land", on: true },
        { id: "transmission", label: "Transmission", on: false },
      ],
      distances: [],
      zones: [],
      pin: { left: 50, top: 50, label: report.location },
    },
    teamMembers: [],
  };
}
