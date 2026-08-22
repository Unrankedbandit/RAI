// Mock scan source — a stand-in for the backend agent stream so the scanning
// experience works end-to-end without a live pipeline. It emits the same
// ScanEvent shape the real backend will, with VARIABLE, unpredictable timing
// (including a deliberate long gap) so the milestone progress, the
// indeterminate shimmer, and the failure states are all exercised for real.

import type { ScanEvent, ScanSource } from "./scanEvents";

export type MockScenario = "default" | "slow" | "error";

type Step = { delay: number; event: ScanEvent };

// A believable Project Alpha run. Delays vary per step; the gap before Finance
// is long on purpose so the bar visibly pulses instead of implying progress.
const RUN: Step[] = [
  { delay: 500, event: { type: "reading_document", filename: "feasibility_study.pdf" } },
  { delay: 700, event: { type: "subagent_spawned", name: "site-control-scan", parentPillar: "Land" } },
  { delay: 900, event: { type: "finding", text: "Landowner agreement and interconnection easement executed.", flag: false } },
  { delay: 800, event: { type: "pillar_complete", pillar: "Land", score: 92, band: "strong" } },

  { delay: 700, event: { type: "reading_document", filename: "schedule.pdf" } },
  { delay: 900, event: { type: "subagent_spawned", name: "permit-sequence-check", parentPillar: "Law" } },
  { delay: 1100, event: { type: "reading_document", filename: "permit_application.pdf" } },
  { delay: 1200, event: { type: "finding", text: "Construction begins ~8 weeks before the environmental permit is expected.", flag: true } },
  { delay: 900, event: { type: "pillar_complete", pillar: "Law", score: 38, band: "risk" } },

  { delay: 1000, event: { type: "reading_document", filename: "vendor_proposal.pdf" } },
  { delay: 900, event: { type: "subagent_spawned", name: "capex-reconciliation", parentPillar: "Finance" } },
  // Deliberate long gap (> 3s) — the agent is thinking; the bar should pulse.
  { delay: 4200, event: { type: "finding", text: "CAPEX $42.0M assumed vs $51.2M quoted — a 21.9% variance.", flag: true } },
  { delay: 800, event: { type: "pillar_complete", pillar: "Finance", score: 61, band: "watch" } },

  { delay: 700, event: { type: "subagent_spawned", name: "supplier-dependency-scan", parentPillar: "Materials" } },
  { delay: 900, event: { type: "finding", text: "Single-source equipment vendor with no documented contingency.", flag: true } },
  { delay: 800, event: { type: "pillar_complete", pillar: "Materials", score: 58, band: "watch" } },

  { delay: 700, event: { type: "subagent_spawned", name: "interconnection-queue-check", parentPillar: "Demand" } },
  { delay: 900, event: { type: "finding", text: "Interconnection queue confirmed for 180 MW; PPA at $38/MWh.", flag: false } },
  { delay: 800, event: { type: "pillar_complete", pillar: "Demand", score: 88, band: "strong" } },

  { delay: 700, event: { type: "complete", projectId: "project-alpha", activationScore: 62 } },
];

export function createMockScanSource(
  scenario: MockScenario = "default",
): ScanSource {
  return ({ onEvent }) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    // error: cut off partway with an error event.
    // slow: emit a few events then go silent (never complete) so the
    //       indeterminate pulse and, eventually, the timeout state trigger.
    let steps: Step[];
    if (scenario === "error") {
      steps = [
        ...RUN.slice(0, 8),
        {
          delay: 900,
          event: {
            type: "error",
            message:
              "The analysis pipeline stopped unexpectedly while reviewing the permit documents. No results were saved.",
          },
        },
      ];
    } else if (scenario === "slow") {
      steps = RUN.slice(0, 3);
    } else {
      steps = RUN;
    }

    let elapsed = 0;
    for (const step of steps) {
      elapsed += step.delay;
      const at = elapsed;
      timers.push(
        setTimeout(() => {
          if (!cancelled) onEvent(step.event);
        }, at),
      );
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  };
}
