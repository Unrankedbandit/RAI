import { createSerwistRoute } from "@serwist/turbopack";
import { spawnSync } from "node:child_process";

/**
 * Serves the compiled service worker at /serwist/sw.js (with
 * `Service-Worker-Allowed: /` so it can control the whole origin) and
 * injects the precache manifest into src/app/sw.ts at build time.
 */
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
