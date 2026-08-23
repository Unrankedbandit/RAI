"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PortfolioShell } from "@/components/portfolio/PortfolioShell";

/**
 * Public landing — what RAI is, what it saves, and one door in: Get started
 * drops the user on the parcel map (/parcels), where a one-time intro popup
 * explains the rest. The old portfolio home is stashed at /dashboard.
 */
export default function LandingPage() {
  return (
    <PortfolioShell>
      <div className="mx-auto max-w-[760px] pt-6 sm:pt-14">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <div className="mb-3 inline-block rounded-full border border-hairline bg-select px-3 py-1 text-[11.5px] font-semibold text-ink">
            Solar due diligence, automated
          </div>
          <h1 className="text-[30px] font-semibold leading-[1.2] text-ink sm:text-[40px]">
            Weeks of analyst work,
            <br />
            compressed into one run.
          </h1>
          <p className="mt-4 max-w-[600px] text-[15px] leading-[1.7] text-muted">
            RAI reads a solar project&apos;s entire diligence package the way no
            reviewer can: every document cross-examined against every other,
            every missing piece chased down from public record, every finding
            cited back to its source — and a readiness score at the end you can
            defend in committee.
          </p>

          <div className="mt-7 flex items-center gap-3">
            <Link
              href="/parcels"
              className="inline-flex items-center gap-2 rounded-full bg-oxford px-6 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Get started
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
            <span className="text-[12.5px] text-faint">
              Opens the California parcel map — no signup.
            </span>
          </div>
        </motion.div>

        {/* Time + cost band */}
        <motion.div
          className="mt-10 rounded-[11px] border border-hairline bg-canvas p-5 shadow-card sm:p-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.12 }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              big="Weeks → minutes"
              text="A senior analyst needs weeks per project dossier. RAI's agent pipeline returns a scored report in minutes."
            />
            <Stat
              big="Dollars, not thousands"
              text="Manual diligence bills tens of thousands in expert hours per project. A RAI run costs a few dollars of compute."
            />
            <Stat
              big="Nothing missed"
              text="Cross-document contradictions and absent studies are where bad deals hide. The pipeline is built to catch exactly those."
            />
          </div>
        </motion.div>

        {/* How it works */}
        <motion.div
          className="mt-8 pb-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.22 }}
        >
          <div className="mb-3 text-[12.5px] font-semibold text-faint">
            How it works
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Step n={1} title="Pick a parcel">
              Click any parcel on the map — get its attributes and an instant,
              honest viability estimate from public land data.
            </Step>
            <Step n={2} title="Run full diligence">
              Specialist agents extract every claim from the documents,
              cross-examine them, and pull the missing numbers from public sources.
            </Step>
            <Step n={3} title="Get the report">
              Readiness score, red flags, contradictions, critical path, and a
              memo you can export and share by link.
            </Step>
          </div>
        </motion.div>
      </div>
    </PortfolioShell>
  );
}

function Stat({ big, text }: { big: string; text: string }) {
  return (
    <div>
      <div className="text-[17px] font-semibold text-ink">{big}</div>
      <p className="mt-1 text-[12.5px] leading-[1.6] text-muted">{text}</p>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[11px] border border-hairline bg-canvas p-5 shadow-card">
      <div className="mb-2.5 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-oxford text-[12.5px] font-semibold text-white">
        {n}
      </div>
      <div className="mb-1 text-sm font-semibold text-ink">{title}</div>
      <p className="text-[12.5px] leading-[1.6] text-muted">{children}</p>
    </div>
  );
}
