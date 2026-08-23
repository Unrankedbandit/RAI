"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ACTIVE_RUN_KEY } from "@/lib/activeRun";

/**
 * Universal return-to-run badge: while an agent run is in flight (marked by the
 * scanning page via sessionStorage), every other page shows this small pill at
 * the bottom-right — "agent research", slow throbbing glow — and it returns you
 * to the live run on click. Hidden while you're already on the run page.
 */
export function RunBadge() {
  const [job, setJob] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const read = () => {
      try {
        setJob(sessionStorage.getItem(ACTIVE_RUN_KEY));
      } catch {
        /* ignore */
      }
    };
    read();
    const t = window.setInterval(read, 1200);
    window.addEventListener("storage", read);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("storage", read);
    };
  }, []);

  if (!job || pathname.startsWith("/scanning")) return null;

  return (
    <button
      type="button"
      className="run-badge"
      onClick={() => router.push(`/scanning?job=${job}`)}
      aria-label="Return to the running agent research"
    >
      agent research
    </button>
  );
}
