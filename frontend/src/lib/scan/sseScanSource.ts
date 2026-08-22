// Real backend scan source — Server-Sent Events.
//
// Used when NEXT_PUBLIC_SCAN_STREAM_URL is configured. The backend streams one
// JSON-encoded ScanEvent per SSE message. A connection that closes before a
// terminal (complete/error) event is surfaced via onClose so the hook can treat
// it as a dropped connection, never as silent success.

import type { ScanEvent, ScanSource } from "./scanEvents";
import { withGateToken } from "@/lib/agent/client";

export function createSseScanSource(url: string): ScanSource {
  return ({ onEvent, onClose }) => {
    let closed = false;
    // EventSource can't set headers — the gate token rides the query string.
    const es = new EventSource(withGateToken(url));

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as ScanEvent;
        onEvent(event);
        if (event.type === "complete" || event.type === "error") {
          closed = true;
          es.close();
        }
      } catch {
        // Ignore malformed frames; the timeout guard covers a stalled stream.
      }
    };

    es.onerror = () => {
      // EventSource fires error on network drop / server close. If we haven't
      // seen a terminal event, this is an unexpected disconnect.
      if (!closed) {
        closed = true;
        es.close();
        onClose();
      }
    };

    return () => {
      closed = true;
      es.close();
    };
  };
}
