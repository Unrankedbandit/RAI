// Mock data layer for RAI.
//
// The hero project ("Project Alpha") is populated to match the approved
// reference implementation (solar-sentinel-project-tabs.html) screen-for-
// screen. The backend replaces these exports with real Bedrock-agent output
// against the same contract in src/lib/types.ts.

import type {
  ChatMessage,
  Project,
  ProjectDetail,
  ProjectStatus,
  RecentActivity,
  RecentDocument,
  RiskBand,
  RiskFactorDefinition,
  ScriptedQA,
} from "./types";

export const ITC_DEADLINE = "2030-12-31";
export const ITC_DEADLINE_LABEL = "Deadline: Dec 31, 2030 · 30% ITC eligibility";

export const riskFactorDefinitions: RiskFactorDefinition[] = [
  {
    name: "Land",
    definition:
      "Site control, title, easements, flood and geotechnical fitness of the ground itself.",
  },
  {
    name: "Law",
    definition:
      "Permitting sequence, environmental review, habitat and zoning that gate construction.",
  },
  {
    name: "Finance",
    definition: "CAPEX accuracy, financing terms, returns and the timing of close.",
  },
  {
    name: "Materials",
    definition:
      "Long-lead equipment, supplier depth, construction feasibility and logistics.",
  },
  {
    name: "Demand",
    definition:
      "Grid interconnection capacity and contracted offtake for the generation.",
  },
];

export function bandFromScore(score: number): RiskBand {
  if (score >= 70) return "strong";
  if (score >= 40) return "watch";
  return "risk";
}

export function statusFromBand(band: RiskBand): ProjectStatus {
  if (band === "strong") return "on-track";
  if (band === "watch") return "needs-review";
  return "at-risk";
}

// ---------------------------------------------------------------------------
// Hero project: Project Alpha (matches the reference implementation)
// ---------------------------------------------------------------------------

const projectAlpha: Project = {
  id: "project-alpha",
  name: "Project Alpha",
  location: "West Texas",
  capacityMW: 180,
  latitude: 31.9,
  longitude: -102.3,
  activationScore: 62,
  band: "watch",
  scoreReason:
    "One open flag in Law and one in Finance put the December 31, 2030 deadline at risk.",
  status: "needs-review",
  pillars: [
    {
      name: "Land",
      score: 92,
      band: "strong",
      unlocked: true,
      statusText: "Unlocked",
      subAgents: ["site-control-scan", "endangered-species-scan"],
      factors: [
        {
          id: "land-site-control",
          name: "Site Control & Land Use",
          band: "strong",
          statusLabel: "Cleared",
          evidence:
            "Landowner agreement and interconnection easement fully executed.",
          sources: ["feasibility_study.pdf"],
        },
        {
          id: "land-ecology",
          name: "Ecological / Endangered Species",
          band: "strong",
          statusLabel: "Cleared",
          evidence: "No listed species habitat within the site boundary.",
          sources: ["geotech_report.pdf"],
        },
      ],
    },
    {
      name: "Law",
      score: 38,
      band: "risk",
      unlocked: false,
      statusText: "1 flag open",
      subAgents: ["permit-sequence-check", "zoning-compliance-scan"],
      factors: [
        {
          id: "law-permit-timeline",
          name: "Environmental Permit Timeline",
          band: "risk",
          statusLabel: "Flagged",
          evidence:
            "Construction begins October, permit approval expected December — a 2-month conflict.",
          sources: ["schedule.pdf", "permit_application.pdf"],
          whyItMatters:
            "If construction proceeds on the current schedule, up to 8 weeks of civil work would happen without a valid environmental permit — risking a stop-work order or fines that could push the timeline further than the conflict itself.",
          recommendedSteps: [
            "Confirm with counsel whether the December permit date can be expedited.",
            "Move the construction start date to align with confirmed permit approval.",
            "Document a contingency plan in case the permit slips further.",
          ],
        },
        {
          id: "law-zoning",
          name: "Zoning & Regulatory Compliance",
          band: "strong",
          statusLabel: "Cleared",
          evidence: "County zoning approved, no variance required.",
          sources: ["permit_application.pdf"],
        },
      ],
    },
    {
      name: "Finance",
      score: 61,
      band: "watch",
      unlocked: false,
      statusText: "1 in watch",
      subAgents: ["capex-reconciliation", "financing-terms-review"],
      factors: [
        {
          id: "finance-capex",
          name: "CAPEX Accuracy",
          band: "watch",
          statusLabel: "Watch",
          evidence: "Vendor quote implies CAPEX ~21% above feasibility estimate.",
          sources: ["feasibility_study.pdf", "vendor_proposal.pdf"],
          whyItMatters:
            "A 21% gap this early raises the risk of a financing shortfall later — if the vendor's numbers hold, the project needs roughly $9M beyond the original budget to close.",
          recommendedSteps: [
            "Request an itemized quote to confirm which cost categories changed.",
            "Re-run the financial model at the higher CAPEX figure.",
            "Check with the lender whether the term sheet can absorb the increase.",
          ],
        },
        {
          id: "finance-terms",
          name: "Financing Terms",
          band: "strong",
          statusLabel: "Cleared",
          evidence: "Term sheet executed at benchmark rates.",
          sources: ["feasibility_study.pdf"],
        },
      ],
    },
    {
      name: "Materials",
      score: 58,
      band: "watch",
      unlocked: false,
      statusText: "1 in watch",
      subAgents: ["supplier-dependency-scan", "soil-composition"],
      factors: [
        {
          id: "materials-supplier",
          name: "Supplier Dependency",
          band: "watch",
          statusLabel: "Watch",
          evidence: "Single-source equipment vendor, no documented contingency.",
          sources: ["vendor_proposal.pdf"],
          whyItMatters:
            "Relying on one vendor for all primary equipment means any delay, price change, or capacity issue on their end directly delays the project, with no fallback in place.",
          recommendedSteps: [
            "Identify at least one qualified secondary supplier.",
            "Request a backup quote to benchmark pricing and lead time.",
            "Add a contingency clause to the primary vendor contract.",
          ],
        },
        {
          id: "materials-soil",
          name: "Construction Feasibility / Soil",
          band: "strong",
          statusLabel: "Cleared",
          evidence: "Soil supports standard racking, 1.2 miles from paved road.",
          sources: ["geotech_report.pdf"],
        },
      ],
    },
    {
      name: "Demand",
      score: 88,
      band: "strong",
      unlocked: true,
      statusText: "Unlocked",
      subAgents: ["interconnection-queue-check", "offtake-coverage-check"],
      factors: [
        {
          id: "demand-grid",
          name: "Grid Interconnection Capacity",
          band: "strong",
          statusLabel: "Cleared",
          evidence: "Queue position confirmed for full 180 MW.",
          sources: ["feasibility_study.pdf"],
        },
        {
          id: "demand-offtake",
          name: "Offtake / Market Demand",
          band: "strong",
          statusLabel: "Cleared",
          evidence: "PPA executed at $38/MWh.",
          sources: ["feasibility_study.pdf"],
        },
      ],
    },
  ],
};

const projectAlphaDetail: ProjectDetail = {
  project: projectAlpha,
  eyebrow: "Solar · 180 MW · West Texas",
  runSummary: "7 documents + 3 sheets analyzed · run #A-1147",
  scoreBandLabel: "Activation Score — At Risk",
  scoreNote:
    "One open flag in Law and one in Finance put the December 31, 2030 deadline at risk.",
  evidence: {},
  timeline: [
    {
      id: "land-secured",
      label: "Land secured",
      shortLabel: "Land secured",
      date: "2026-08-03",
      dateDisplay: "Aug 3, 2026",
      description:
        "Landowner agreement and interconnection easement fully executed.",
      band: "strong",
      position: 6,
      kind: "milestone",
    },
    {
      id: "construction",
      label: "Construction start",
      shortLabel: "Construction (Oct)",
      date: "2026-10-14",
      dateDisplay: "Oct 14, 2026 (scheduled)",
      description: "Civil works commencement per the project schedule.",
      conflictNote:
        "Conflicts with permit approval — starts 8 weeks before the permit is expected.",
      band: "risk",
      position: 30,
      conflictKey: "permit-timeline",
      kind: "milestone",
    },
    {
      id: "permit",
      label: "Environmental permit approval",
      shortLabel: "Permit (Dec)",
      date: "2026-12-08",
      dateDisplay: "Dec 8, 2026 (expected)",
      description: "Authority decision on the environmental permit application.",
      conflictNote:
        "Conflicts with construction start — approval lands after civil works are scheduled to begin.",
      band: "risk",
      position: 42,
      conflictKey: "permit-timeline",
      kind: "milestone",
    },
    {
      id: "financial-close",
      label: "Financial close",
      shortLabel: "Financial close",
      date: "2027-01-15",
      dateDisplay: "Jan 2027 (projected)",
      description:
        "Contingent on resolving the CAPEX variance flagged in Finance before the lender finalizes terms.",
      band: "watch",
      position: 64,
      kind: "milestone",
    },
    {
      id: "cod",
      label: "Commercial operation date",
      shortLabel: "COD target",
      date: "2027-06-01",
      dateDisplay: "Jun 2027 (target)",
      description: "On pace assuming no further delays from open flags.",
      band: "strong",
      position: 88,
      kind: "milestone",
    },
    {
      id: "deadline",
      label: "Activation deadline",
      shortLabel: "Deadline",
      date: ITC_DEADLINE,
      dateDisplay: "Dec 31, 2030",
      description:
        "30% ITC eligibility expires after this date — everything on this timeline is racing against it.",
      band: "risk",
      position: 97,
      kind: "deadline",
    },
  ],
  documents: [
    { id: "doc-feasibility", title: "feasibility_study.pdf", kind: "Feasibility study", size: "2.1 MB", pillars: ["Land", "Finance", "Demand"] },
    { id: "doc-vendor", title: "vendor_proposal.pdf", kind: "Vendor proposal", size: "640 KB", pillars: ["Finance", "Materials"] },
    { id: "doc-schedule", title: "schedule.pdf", kind: "Project schedule", size: "180 KB", pillars: ["Law"] },
    { id: "doc-permit", title: "permit_application.pdf", kind: "Permit application", size: "950 KB", pillars: ["Law"] },
    { id: "doc-geotech", title: "geotech_report.pdf", kind: "Geotechnical report", size: "1.4 MB", pillars: ["Land", "Materials"] },
  ],
  priorityActions: [
    {
      id: "pa-1",
      rank: 1,
      title: "Resolve the permit-timeline conflict in Law",
      detail:
        "Construction is scheduled 8 weeks before the environmental permit is expected — realign the dates before civil works begin.",
      impact: "high",
      evidenceLink: "law-permit-timeline",
      scoreDelta: 14,
    },
    {
      id: "pa-2",
      rank: 2,
      title: "Confirm a secondary equipment supplier",
      detail:
        "All primary equipment is single-sourced with no contingency — qualify a backup vendor.",
      impact: "medium",
      evidenceLink: "materials-supplier",
      scoreDelta: 7,
    },
  ],
  projectedScoreAfterMitigation: 83,
  suggestedQuestions: [
    {
      question: "Why is the score 62?",
      answer: {
        role: "assistant",
        text: "The Activation Score weights Law and Finance highest, since those two carry the most deadline risk. Law is flagged for a permit-timeline conflict and Finance is in watch for a CAPEX variance — together they pull the score down from an otherwise strong 88 average across Land, Materials, and Demand.",
      },
    },
    {
      question: "What changed since the last run?",
      answer: {
        role: "assistant",
        text: "Since the last run, the Materials supplier flag moved from Cleared to Watch after the updated vendor proposal removed the previously documented secondary supplier. Everything else is unchanged.",
      },
    },
    {
      question: "What would raise this above 80?",
      answer: {
        role: "assistant",
        text: "Two actions would move the score most: resolving the permit-timeline conflict in Law (+14), and confirming a secondary equipment supplier in Materials (+7). Together they'd bring the Activation Score to 83.",
      },
    },
  ],
  chatHistory: [],
  report: {
    badge: "Draft — not exported",
    title: "Due Diligence Memo — Project Alpha",
    preparedBy: "Prepared by RAI · Aug 14, 2026 · Run #A-1147",
    summary:
      "Project Alpha carries an Activation Score of 62 (At Risk). Two open items — a permit-timeline conflict in Law and a CAPEX variance in Finance — put the December 31, 2030 subsidy deadline at risk. Land and Demand are fully cleared. Resolving both open items would raise the score to an estimated 83.",
    findings: [
      {
        title: "Environmental permit timeline conflict",
        text: "Construction begins October, permit approval expected December — an 8-week overlap that risks a stop-work order if unresolved.",
      },
      {
        title: "CAPEX assumption below quoted equipment cost",
        text: "Feasibility study assumes $42.0M; vendor quote implies $51.2M, a 21.9% variance requiring roughly $9M in additional funding.",
      },
      {
        title: "Single-source supplier dependency",
        text: "All primary equipment is sourced from one vendor with no documented secondary supplier or contingency terms.",
      },
    ],
    recommendedActions: [
      "Resolve the permit-timeline conflict in Law — projected +14 pts",
      "Confirm a secondary equipment supplier — projected +7 pts",
    ],
    sourceBasis:
      "Based on 7 documents and 3 spreadsheets uploaded for this project. Full evidence trail with source citations is available in the Overview tab.",
  },
  map: {
    parcelSize: "180 acres",
    toggles: [
      { id: "watersheds", label: "Watersheds", on: true },
      { id: "zoning", label: "Historical zoning", on: false },
      { id: "grid", label: "Grid interconnectivity", on: false },
    ],
    distances: [
      { label: "Nearest paved road", value: "1.2 mi" },
      { label: "Interconnection point", value: "0.4 mi" },
      { label: "Nearest surface water", value: "0.8 mi" },
    ],
    zones: [
      {
        id: "suitable",
        type: "suitable",
        title: "Suitable for development",
        description:
          "No wetlands, floodplain, or protected habitat identified within this area. Clear for standard construction.",
        source: "geotech_report.pdf",
        bounds: { left: 8, top: 12, width: 60, height: 65 },
      },
      {
        id: "restricted",
        type: "restricted",
        title: "Restricted — wetland buffer",
        description:
          "A 100 ft wetland buffer applies to this corner of the parcel per county ordinance 4.2, limiting construction within the shaded area.",
        source: "zoning_approval.pdf",
        bounds: { left: 58, top: 52, width: 30, height: 34 },
      },
    ],
    pin: { left: 34, top: 38, label: "Interconnection point" },
  },
  teamMembers: [
    { name: "Chloe Martinez", email: "chloe@company.com", access: "limited" },
  ],
};

// ---------------------------------------------------------------------------
// Portfolio siblings (lighter, retoned to the reference palette)
// ---------------------------------------------------------------------------

function pillarStatusText(band: RiskBand): string {
  if (band === "strong") return "Unlocked";
  if (band === "watch") return "1 in watch";
  return "1 flag open";
}

const PILLAR_NAMES = ["Land", "Law", "Finance", "Materials", "Demand"] as const;

function makeSibling(opts: {
  id: string;
  name: string;
  tech: string;
  capacityMW: number;
  location: string;
  latitude: number;
  longitude: number;
  activationScore: number;
  band: RiskBand;
  status: ProjectStatus;
  scoreReason: string;
  pillarBands: RiskBand[];
  pillarScores: number[];
}): Project {
  return {
    id: opts.id,
    name: opts.name,
    tech: opts.tech,
    location: opts.location,
    capacityMW: opts.capacityMW,
    latitude: opts.latitude,
    longitude: opts.longitude,
    activationScore: opts.activationScore,
    band: opts.band,
    scoreReason: opts.scoreReason,
    status: opts.status,
    pillars: PILLAR_NAMES.map((name, i) => {
      const band = opts.pillarBands[i];
      return {
        name,
        score: opts.pillarScores[i],
        band,
        unlocked: band === "strong",
        statusText: pillarStatusText(band),
        subAgents: ["scan-a", "scan-b"],
        factors: [
          {
            id: `${opts.id}-${name}-1`,
            name: `${name} readiness`,
            band,
            statusLabel:
              band === "strong" ? "Cleared" : band === "watch" ? "Watch" : "Flagged",
            evidence:
              band === "strong"
                ? `${name} cleared with no open items.`
                : band === "watch"
                  ? `${name} has one item under review.`
                  : `${name} has an open item that needs resolution.`,
            sources: ["feasibility_study.pdf"],
            ...(band !== "strong"
              ? {
                  whyItMatters: `The open ${name.toLowerCase()} item can shift cost or timing if it is not resolved before the next milestone.`,
                  recommendedSteps: [
                    `Request the latest ${name.toLowerCase()} documentation.`,
                    "Update the model and re-check covenant headroom.",
                  ],
                }
              : {}),
          },
        ],
      };
    }),
  };
}

const projectBeta = makeSibling({
  id: "project-beta",
  name: "Project Beta",
  tech: "Solar + BESS",
  capacityMW: 240,
  location: "Nevada",
  latitude: 39.16,
  longitude: -117.0,
  activationScore: 84,
  band: "strong",
  status: "on-track",
  scoreReason:
    "Site control, permits, financing and offtake are all cleared — on track to activation.",
  pillarBands: ["strong", "strong", "strong", "watch", "strong"],
  pillarScores: [90, 86, 82, 68, 88],
});

const projectGamma = makeSibling({
  id: "project-gamma",
  name: "Project Gamma",
  tech: "Solar",
  capacityMW: 95,
  location: "New Mexico",
  latitude: 34.52,
  longitude: -105.87,
  activationScore: 41,
  band: "risk",
  status: "at-risk",
  scoreReason:
    "An unresolved interconnection queue position and an open permit put activation at risk.",
  pillarBands: ["watch", "risk", "watch", "watch", "risk"],
  pillarScores: [58, 34, 52, 55, 33],
});

const projectDelta = makeSibling({
  id: "project-delta",
  name: "Project Delta",
  tech: "Solar",
  capacityMW: 60,
  location: "Arizona",
  latitude: 33.45,
  longitude: -112.07,
  activationScore: 79,
  band: "strong",
  status: "on-track",
  scoreReason:
    "Fundamentals are cleared; only a minor materials watch remains before full activation.",
  pillarBands: ["strong", "strong", "watch", "strong", "strong"],
  pillarScores: [88, 80, 66, 84, 86],
});

const projectEpsilon = makeSibling({
  id: "project-epsilon",
  name: "Project Epsilon",
  tech: "Solar",
  capacityMW: 310,
  location: "Colorado",
  latitude: 39.55,
  longitude: -105.78,
  activationScore: 57,
  band: "watch",
  status: "needs-review",
  scoreReason:
    "A pending permit review and a partially contracted offtake keep two components in review.",
  pillarBands: ["strong", "watch", "watch", "strong", "watch"],
  pillarScores: [76, 52, 58, 74, 50],
});

function lightDetail(project: Project): ProjectDetail {
  const openFactors = project.pillars
    .flatMap((p) => p.factors)
    .filter((f) => f.band !== "strong");
  return {
    project,
    eyebrow: `${project.tech ?? "Solar"} · ${project.capacityMW} MW · ${project.location}`,
    runSummary: "5 documents + 2 sheets analyzed",
    scoreBandLabel:
      project.band === "strong"
        ? "Activation Score — On Track"
        : project.band === "watch"
          ? "Activation Score — Needs Review"
          : "Activation Score — At Risk",
    scoreNote: project.scoreReason,
    evidence: {},
    timeline: [
      { id: "land", label: "Land secured", shortLabel: "Land secured", date: "2026-09-01", dateDisplay: "Sep 1, 2026", description: "Site control executed.", band: "strong", position: 10, kind: "milestone" },
      { id: "permit", label: "Permit approval", shortLabel: "Permit", date: "2027-03-01", dateDisplay: "Mar 2027 (expected)", description: "Environmental permit decision.", band: "watch", position: 40, kind: "milestone" },
      { id: "close", label: "Financial close", shortLabel: "Financial close", date: "2027-06-01", dateDisplay: "Jun 2027 (projected)", description: "Debt and equity finalize.", band: "watch", position: 64, kind: "milestone" },
      { id: "cod", label: "Commercial operation date", shortLabel: "COD target", date: "2028-02-01", dateDisplay: "Feb 2028 (target)", description: "Commercial operation.", band: "strong", position: 86, kind: "milestone" },
      { id: "deadline", label: "Activation deadline", shortLabel: "Deadline", date: ITC_DEADLINE, dateDisplay: "Dec 31, 2030", description: "30% ITC eligibility expires after this date.", band: "risk", position: 97, kind: "deadline" },
    ],
    documents: [
      { id: `${project.id}-d1`, title: "feasibility_study.pdf", kind: "Feasibility study", size: "1.9 MB", pillars: ["Land", "Finance"] },
      { id: `${project.id}-d2`, title: "vendor_proposal.pdf", kind: "Vendor proposal", size: "520 KB", pillars: ["Materials"] },
      { id: `${project.id}-d3`, title: "offtake_agreement.pdf", kind: "Offtake agreement", size: "700 KB", pillars: ["Demand"] },
    ],
    priorityActions: openFactors.slice(0, 2).map((f, i) => ({
      id: `${project.id}-pa-${i + 1}`,
      rank: i + 1,
      title: `Resolve ${f.name.toLowerCase()}`,
      detail: f.evidence,
      impact: f.band === "risk" ? ("high" as const) : ("medium" as const),
      evidenceLink: f.id,
      scoreDelta: f.band === "risk" ? 12 : 6,
    })),
    projectedScoreAfterMitigation: Math.min(
      100,
      project.activationScore + (project.band === "strong" ? 6 : 18),
    ),
    suggestedQuestions: [
      {
        question: `Why is the score ${project.activationScore}?`,
        answer: {
          role: "assistant",
          text: `${project.name}'s score reflects its open items: ${project.scoreReason.charAt(0).toLowerCase()}${project.scoreReason.slice(1)}`,
        },
      },
      {
        question: "What would raise this above 80?",
        answer: {
          role: "assistant",
          text: `Clearing ${project.name}'s open ${openFactors.length === 1 ? "item" : "items"} would move the score most — the cleared components are already holding it up.`,
        },
      },
    ],
    chatHistory: [] as ChatMessage[],
    report: {
      badge: "Draft — not exported",
      title: `Due Diligence Memo — ${project.name}`,
      preparedBy: "Prepared by RAI · Aug 14, 2026",
      summary: `${project.name} carries an Activation Score of ${project.activationScore}. ${project.scoreReason}`,
      findings: openFactors.slice(0, 3).map((f) => ({
        title: f.name,
        text: f.evidence,
      })),
      recommendedActions: openFactors
        .slice(0, 2)
        .map(
          (f, i) =>
            `Resolve ${f.name.toLowerCase()} — projected +${f.band === "risk" ? 12 : 6} pts${i === 0 ? "" : ""}`,
        ),
      sourceBasis:
        "Based on 5 documents and 2 spreadsheets uploaded for this project.",
    },
    map: {
      parcelSize: `${project.capacityMW} acres`,
      toggles: [
        { id: "watersheds", label: "Watersheds", on: true },
        { id: "zoning", label: "Historical zoning", on: false },
        { id: "grid", label: "Grid interconnectivity", on: false },
      ],
      distances: [
        { label: "Nearest paved road", value: "2.0 mi" },
        { label: "Interconnection point", value: "0.6 mi" },
        { label: "Nearest surface water", value: "1.1 mi" },
      ],
      zones: [
        {
          id: "suitable",
          type: "suitable",
          title: "Suitable for development",
          description:
            "No wetlands or protected habitat identified within this area.",
          source: "geotech_report.pdf",
          bounds: { left: 10, top: 14, width: 58, height: 62 },
        },
        {
          id: "restricted",
          type: "restricted",
          title: "Restricted — review required",
          description: "A setback applies to this corner of the parcel.",
          source: "zoning_approval.pdf",
          bounds: { left: 60, top: 54, width: 28, height: 32 },
        },
      ],
      pin: { left: 36, top: 40, label: "Interconnection point" },
    },
    teamMembers: [],
  };
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export const projectDetails: Record<string, ProjectDetail> = {
  [projectAlpha.id]: projectAlphaDetail,
  [projectBeta.id]: lightDetail(projectBeta),
  [projectGamma.id]: lightDetail(projectGamma),
  [projectDelta.id]: lightDetail(projectDelta),
  [projectEpsilon.id]: lightDetail(projectEpsilon),
};

export const projects: Project[] = [
  projectAlpha,
  projectBeta,
  projectGamma,
  projectDelta,
  projectEpsilon,
];

export function getProject(id: string): Project | undefined {
  return projectDetails[id]?.project;
}

export function getProjectDetail(id: string): ProjectDetail | undefined {
  return projectDetails[id];
}

export function portfolioSummary() {
  const count = projects.length;
  const avgScore = Math.round(
    projects.reduce((sum, p) => sum + p.activationScore, 0) / count,
  );
  const onTrack = projects.filter((p) => p.status === "on-track").length;
  const needsReview = projects.filter((p) => p.status === "needs-review").length;
  const atRisk = projects.filter((p) => p.status === "at-risk").length;
  return { count, avgScore, avgBand: bandFromScore(avgScore), onTrack, needsReview, atRisk };
}

export const recentDocuments: RecentDocument[] = [
  { title: "vendor_proposal.pdf", project: "Project Alpha", status: "Analyzed", addedAt: "2026-08-14" },
  { title: "permit_application.pdf", project: "Project Alpha", status: "Analyzed", addedAt: "2026-08-14" },
  { title: "offtake_agreement.pdf", project: "Project Epsilon", status: "Scanning", addedAt: "2026-08-14" },
  { title: "interconnection_study.pdf", project: "Project Gamma", status: "Queued", addedAt: "2026-08-13" },
];

/** Home "recent activity" — mixed project and document rows. */
export const recentActivity: RecentActivity[] = [
  { name: "Project Epsilon", kind: "Project", status: "needs-review", time: "Yesterday" },
  { name: "vendor_proposal.pdf", kind: "Document", project: "Project Alpha", time: "Yesterday" },
  { name: "Project Gamma", kind: "Project", status: "at-risk", time: "3 days ago" },
  { name: "feasibility_study.pdf", kind: "Document", project: "Project Alpha", time: "3 days ago" },
  { name: "Project Beta", kind: "Project", status: "on-track", time: "5 days ago" },
];

/** Portfolio-level scripted answers for the Home / Current Projects rail. */
export const portfolioSuggestedQuestions: ScriptedQA[] = [
  {
    question: "Which projects need review?",
    answer: {
      role: "assistant",
      text: "Two projects are flagged for review — Project Alpha (a permit-timeline conflict and a CAPEX variance) and Project Epsilon (a pending permit review and partially contracted offtake). Project Gamma is the one at-risk project, held back by an unresolved interconnection queue position.",
    },
  },
  {
    question: "What's blocking the December deadline?",
    answer: {
      role: "assistant",
      text: "Across the pipeline the recurring blockers are permit timing and interconnection: Alpha's construction is scheduled ahead of its permit, Gamma's queue position is unresolved, and Epsilon's permit review is still open. Beta and Delta are clear.",
    },
  },
];
