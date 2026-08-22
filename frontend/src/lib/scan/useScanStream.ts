"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ScanEvent, ScanSource } from "./scanEvents";
import {
  initialScanData,
  reduceScan,
  type ScanData,
} from "./scanState";

/** No event for this long → show an indeterminate (pulsing) bar. */
const STALE_MS = 3000;
/** No event for this long with no terminal event → timeout state.
 *  3 minutes of true silence means the process is hung; a slow-but-alive
 *  run (single model calls can exceed 60s) must never see this screen. */
const TIMEOUT_MS = 180000;

export type ScanPhase =
  | "connecting"
  | "scanning"
  | "indeterminate"
  | "complete"
  | "error"
  | "timeout";

export type ScanStreamState = ScanData & { phase: ScanPhase };

type Action = { kind: "event"; event: ScanEvent } | { kind: "reset" };

function dataReducer(state: ScanData, action: Action): ScanData {
  if (action.kind === "reset") return initialScanData;
  return reduceScan(state, action.event);
}

function derivePhase(
  data: ScanData,
  stale: boolean,
  timedOut: boolean,
): ScanPhase {
  if (data.result) return "complete";
  if (data.error) return "error";
  if (timedOut) return "timeout";
  if (stale) return "indeterminate";
  if (data.eventCount > 0) return "scanning";
  return "connecting";
}

/**
 * Subscribe to a scan source and expose the derived UI state plus controls.
 * `makeSource` is called once per attempt; pass a stable reference (its latest
 * value is captured in a ref, so it can be defined inline without re-subscribing
 * on every render).
 */
export function useScanStream(makeSource: () => ScanSource): {
  state: ScanStreamState;
  cancel: () => void;
  retry: () => void;
  keepWaiting: () => void;
} {
  const [data, dispatch] = useReducer(dataReducer, initialScanData);
  const [stale, setStale] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const makeSourceRef = useRef(makeSource);
  useEffect(() => {
    makeSourceRef.current = makeSource;
  });

  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (staleTimer.current) clearTimeout(staleTimer.current);
    if (timeoutTimer.current) clearTimeout(timeoutTimer.current);
    staleTimer.current = null;
    timeoutTimer.current = null;
  }, []);

  const armTimers = useCallback(() => {
    clearTimers();
    staleTimer.current = setTimeout(() => setStale(true), STALE_MS);
    timeoutTimer.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
  }, [clearTimers]);

  useEffect(() => {
    // State is reset by retry() before attempt changes; the first run starts
    // from initial state. Here we only (re)subscribe and arm the timers.
    armTimers();

    const source = makeSourceRef.current();
    const cancel = source({
      onEvent: (event) => {
        dispatch({ kind: "event", event });
        setStale(false);
        if (event.type === "complete" || event.type === "error") {
          clearTimers();
        } else {
          armTimers();
        }
      },
      onClose: () => {
        // Dropped before a terminal event — treat as a timeout, never success.
        clearTimers();
        setTimedOut(true);
      },
    });
    cancelRef.current = cancel;

    return () => {
      cancel();
      cancelRef.current = null;
      clearTimers();
    };
    // Re-subscribe only on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    clearTimers();
  }, [clearTimers]);

  const retry = useCallback(() => {
    dispatch({ kind: "reset" });
    setStale(false);
    setTimedOut(false);
    setAttempt((a) => a + 1);
  }, []);

  const keepWaiting = useCallback(() => {
    setTimedOut(false);
    setStale(false);
    armTimers();
  }, [armTimers]);

  // While the gap-review gate is open the pipeline is deliberately paused —
  // silence is expected, so it must never trip the stream-timeout screen.
  const gateOpen = data.gate !== null && data.gate.resolved === null;
  const phase = derivePhase(data, stale, timedOut && !gateOpen);

  return { state: { ...data, phase }, cancel, retry, keepWaiting };
}
