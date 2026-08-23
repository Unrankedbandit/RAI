import type { Metadata } from "next";
import { LEGAL_SECTIONS, LEGAL_TEMPLATE_NOTE } from "@/lib/legal";

export const metadata: Metadata = {
  title: "RAI — Legal & privacy",
  description:
    "Terms of use, AI output disclaimer, privacy practices, and liability limits for RAI.",
};

export default function LegalPage() {
  return (
    <div className="mx-auto max-w-[760px] px-5 py-8">
      <div className="text-2xl font-semibold text-ink">Legal & privacy</div>
      <p className="mt-1 mb-[22px] text-[15px] text-muted">
        The full text of the terms shown in the consent dialog. Using RAI
        requires accepting these terms.
      </p>

      <div className="overflow-hidden rounded-[11px] border border-hairline bg-canvas shadow-card">
        {LEGAL_SECTIONS.map((section, i) => (
          <section
            key={section.id}
            id={section.id}
            className={i > 0 ? "border-t border-hairline px-5 py-[18px]" : "px-5 py-[18px]"}
          >
            <h2 className="text-sm font-semibold text-ink">{section.title}</h2>
            {section.body.map((para, j) => (
              <p
                key={j}
                className="mt-2 text-[13.5px] leading-relaxed text-muted"
              >
                {para}
              </p>
            ))}
          </section>
        ))}
      </div>

      <p className="mt-4 text-[12px] text-faint">{LEGAL_TEMPLATE_NOTE}</p>
    </div>
  );
}
