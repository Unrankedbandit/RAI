"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { ActivityAccordion } from "@/components/findings/detail/ActivityAccordion";
import { EvidencePanels } from "@/components/findings/detail/EvidencePanels";
import { FieldGrid } from "@/components/findings/detail/FieldGrid";
import { LinkedFindings } from "@/components/findings/detail/LinkedFindings";
import { AskLauncher } from "@/components/ui/AskLauncher";
import { SourceAttribution } from "@/components/ui/SourceLink";
import { getFinding } from "@/lib/mockData";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold text-ink">{children}</h2>
  );
}

export default function FindingDetailPage() {
  const params = useParams<{ id: string }>();
  const finding = getFinding(params.id);

  if (!finding) {
    return (
      <PortfolioShell>
        <div className="flex flex-col items-center py-24 text-center">
          <div className="text-[20px] font-semibold text-ink">
            Finding not found
          </div>
          <Link
            href="/findings"
            className="mt-3 text-sm text-muted underline underline-offset-2 hover:text-ink"
          >
            ← Back to Findings
          </Link>
        </div>
      </PortfolioShell>
    );
  }

  return (
    <PortfolioShell>
      <Link
        href="/findings"
        className="text-sm text-muted hover:text-ink"
      >
        ← Findings
      </Link>

      <div className="mt-2 flex items-center gap-2.5">
        <span className="mono text-[12.5px] text-faint">
          {finding.id}
        </span>
        <h1 className="text-2xl font-semibold text-ink">{finding.title}</h1>
        <AskLauncher context={{ scope: "finding", findingId: finding.id }} />
      </div>

      {/*
        Unified document surface — ONE hairline-bordered container, no
        shadow. Sections flow as a single document separated by hairline
        dividers; inner content never gets its own card chrome.
      */}
      <div className="mt-4 rounded-[11px] border border-hairline bg-canvas">
        <div className="divide-y divide-hairline">
          <section className="px-6 py-5">
            <FieldGrid finding={finding} />
          </section>

          <ActivityAccordion activity={finding.activity} />

          <section className="px-6 py-5">
            <SectionTitle>Why it matters</SectionTitle>
            <p className="text-sm leading-relaxed text-muted">
              {finding.whyItMatters}
            </p>
          </section>

          <section className="px-6 py-5">
            <SectionTitle>Evidence</SectionTitle>
            <EvidencePanels finding={finding} />
          </section>

          <section className="px-6 py-5">
            <SectionTitle>External sources</SectionTitle>
            <div className="text-sm">
              <SourceAttribution sources={finding.sourceUrls ?? []} />
            </div>
          </section>

          <section className="px-6 py-5">
            <SectionTitle>Recommended action</SectionTitle>
            <p className="text-sm leading-relaxed text-muted">
              {finding.recommendedAction}
            </p>
          </section>

          {finding.linkedFindings && finding.linkedFindings.length > 0 && (
            <section className="px-6 py-5">
              <SectionTitle>Linked findings</SectionTitle>
              <LinkedFindings links={finding.linkedFindings} />
            </section>
          )}
        </div>
      </div>
    </PortfolioShell>
  );
}
