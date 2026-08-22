"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PortfolioShell } from "@/components/portfolio/PortfolioShell";
import { ActivityAccordion } from "@/components/findings/detail/ActivityAccordion";
import { EvidencePanels } from "@/components/findings/detail/EvidencePanels";
import { FieldGrid } from "@/components/findings/detail/FieldGrid";
import { LinkedFindings } from "@/components/findings/detail/LinkedFindings";
import { AskLauncher } from "@/components/ui/AskLauncher";
import { Card } from "@/components/ui/Card";
import { getFinding } from "@/lib/mockData";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[12.5px] font-semibold text-ink">{children}</h2>
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
            className="mt-3 text-[13px] text-muted underline underline-offset-2 hover:text-ink"
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
        className="text-[12.5px] text-muted hover:text-ink"
      >
        ← Findings
      </Link>

      <div className="mt-2 flex items-center gap-2.5">
        <span className="font-jetbrains text-[12px] text-faint">
          {finding.id}
        </span>
        <h1 className="text-[20px] font-semibold text-ink">{finding.title}</h1>
        <AskLauncher context={{ scope: "finding", findingId: finding.id }} />
      </div>

      <div className="mt-4 flex flex-col gap-6">
        <FieldGrid finding={finding} />

        <ActivityAccordion activity={finding.activity} />

        <section>
          <SectionTitle>Why it matters</SectionTitle>
          <Card>
            <p className="text-[13.5px] leading-[1.6] text-muted">
              {finding.whyItMatters}
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>Evidence</SectionTitle>
          <EvidencePanels finding={finding} />
        </section>

        <section>
          <SectionTitle>Recommended action</SectionTitle>
          <Card>
            <p className="text-[13.5px] leading-[1.6] text-muted">
              {finding.recommendedAction}
            </p>
          </Card>
        </section>

        {finding.linkedFindings && finding.linkedFindings.length > 0 && (
          <section>
            <SectionTitle>Linked findings</SectionTitle>
            <LinkedFindings links={finding.linkedFindings} />
          </section>
        )}
      </div>
    </PortfolioShell>
  );
}
