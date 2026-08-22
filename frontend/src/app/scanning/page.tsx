"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/ui/PageContainer";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ScanProgress } from "@/components/scanning/ScanProgress";
import { ReasoningTrail } from "@/components/scanning/ReasoningTrail";
import { SubAgentTrail } from "@/components/scanning/SubAgentTrail";
import { GapReviewCard } from "@/components/scanning/GapReviewCard";
import { useScanStream } from "@/lib/scan/useScanStream";
import { createMockScanSource, type MockScenario } from "@/lib/scan/mockScanSource";
import { createSseScanSource } from "@/lib/scan/sseScanSource";
import { createLiveScanSource } from "@/lib/scan/liveScanSource";
import type { ScanSource } from "@/lib/scan/scanEvents";

const STREAM_URL = process.env.NEXT_PUBLIC_SCAN_STREAM_URL;

function parseScenario(value: string | null): MockScenario {
  return value === "error" || value === "slow" || value === "gate"
    ? value
    : "default";
}

/**
 * Drives the scanning experience from three interchangeable sources, all behind
 * the same hook and UI:
 *   - a real agent run when the route carries `?job=<jobId>` (the live backend),
 *   - a generic SSE stream when NEXT_PUBLIC_SCAN_STREAM_URL is set,
 *   - otherwise the built-in mock, so the demo survives with no backend.
 */
function ScanningView() {
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get("job");
  const projectId = params.get("project") ?? "project-alpha";
  const scenario = parseScenario(params.get("sim"));

  const makeSource = useCallback((): ScanSource => {
    if (jobId) return createLiveScanSource(jobId, projectId);
    if (STREAM_URL) return createSseScanSource(STREAM_URL);
    return createMockScanSource(scenario);
  }, [jobId, projectId, scenario]);

  const { state, cancel, retry, keepWaiting } = useScanStream(makeSource);

  // Auto-advance to the real project once the scan completes.
  const advancedRef = useRef(false);
  const resultId = state.result?.projectId ?? null;
  useEffect(() => {
    if (state.phase !== "complete" || !resultId || advancedRef.current) return;
    advancedRef.current = true;
    const t = setTimeout(() => router.push(`/projects/${resultId}`), 1000);
    return () => clearTimeout(t);
  }, [state.phase, resultId, router]);

  // A live run that dies must never leave the demo on an error corpse: after a
  // short beat with the honest message, continue into the scripted demo scan.
  const failedRef = useRef(false);
  useEffect(() => {
    if (state.phase !== "error" || !jobId || failedRef.current) return;
    failedRef.current = true;
    const t = setTimeout(() => router.push("/scanning"), 5000);
    return () => clearTimeout(t);
  }, [state.phase, jobId, router]);

  if (state.phase === "error") {
    return (
      <PageContainer className="max-w-3xl">
        <Card>
          <h1 className="text-xl font-semibold text-ink">
            Live run couldn&apos;t finish
          </h1>
          <p className="mt-2 text-muted">
            {state.error ??
              "The analysis stopped unexpectedly and no results were saved."}
          </p>
          <p className="mt-3 text-sm text-muted">
            Continuing with the demo scan in a few seconds…
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button
              variant="primary"
              onClick={() => router.push("/scanning")}
            >
              Continue with demo scan
            </Button>
            <Button variant="secondary" onClick={() => retry()}>
              Retry live
            </Button>
            <Button variant="secondary" onClick={() => router.push("/projects")}>
              Back
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  if (state.phase === "timeout") {
    return (
      <PageContainer className="max-w-3xl">
        <Card>
          <h1 className="text-xl font-semibold text-ink">
            This is taking longer than expected
          </h1>
          <p className="mt-2 text-muted">
            RAI is still working, but nothing has come back for a while. You can
            keep waiting or stop here and come back later.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" onClick={() => keepWaiting()}>
              Keep waiting
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                cancel();
                router.push("/projects");
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  if (state.phase === "complete") {
    return (
      <PageContainer className="max-w-3xl">
        <div className="mb-6">
          <p className="text-sm text-vista">New project</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            Analysis complete
          </h1>
          <p className="mt-1 text-muted">
            Activation score: {state.result?.activationScore}
          </p>
        </div>

        <Card>
          <ScanProgress
            percent={100}
            indeterminate={false}
            file={state.currentFile}
            done
          />

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-faint">Live reasoning</p>
              <p className="text-xs text-faint tabular-nums">
                {state.flagCount > 0 ? `${state.flagCount} flagged` : "Complete"}
              </p>
            </div>
            <ReasoningTrail lines={state.trail} />
          </div>

          <div className="mt-5 border-t border-hairline pt-4">
            <SubAgentTrail subAgents={state.subAgents} done />
          </div>
        </Card>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">Opening the project.</p>
          <Button
            variant="primary"
            onClick={() => resultId && router.push(`/projects/${resultId}`)}
          >
            View project
          </Button>
        </div>
      </PageContainer>
    );
  }

  // "connecting" | "scanning" | "indeterminate" — the live scan view.
  const indeterminate = state.phase === "indeterminate";

  return (
    <PageContainer className="max-w-3xl">
      <div className="mb-6">
        <p className="text-sm text-vista">
          {jobId ? "Live agent run" : "New project"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Reading the document set
        </h1>
        <p className="mt-1 text-muted">
          RAI is reading the documents and cross-checking them across the five
          pillars.
        </p>
      </div>

      <Card>
        <ScanProgress
          percent={state.percent}
          indeterminate={indeterminate}
          file={state.currentFile}
          done={false}
        />

        {indeterminate && (
          <p className="mt-2 text-xs text-muted">Still working…</p>
        )}

        {state.gate && (
          <div className="mt-5">
            <GapReviewCard
              jobId={jobId}
              gaps={state.gate.gaps}
              timeoutS={state.gate.timeoutS}
              resolved={state.gate.resolved}
            />
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-faint">Live reasoning</p>
            <p className="text-xs text-faint tabular-nums">
              {state.flagCount > 0 ? `${state.flagCount} flagged` : "Scanning"}
            </p>
          </div>
          <ReasoningTrail lines={state.trail} />
        </div>

        <div className="mt-5 border-t border-hairline pt-4">
          <SubAgentTrail subAgents={state.subAgents} done={false} />
        </div>
      </Card>
    </PageContainer>
  );
}

export default function ScanningPage() {
  return (
    <Suspense fallback={null}>
      <ScanningView />
    </Suspense>
  );
}
