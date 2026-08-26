/**
 * RAI service worker — Serwist (the supported Next 16 PWA path; next-pwa is
 * dead). Bundled by esbuild through the /serwist/[path] route handler
 * (createSerwistRoute), which injects the precache manifest and serves the
 * compiled worker at /serwist/sw.js with `Service-Worker-Allowed: /`.
 *
 * Caching policy:
 *  - App shell + static assets: precached (self.__SW_MANIFEST) at install.
 *  - Navigations/documents: network-first, offline falls back to the cached
 *    shell, then to the precached /~offline page.
 *  - API calls (same-origin /api/* and the remote agent backend): network-first
 *    with a 5s timeout and a small, short-lived cache — responses are never
 *    cached aggressively; the app already degrades to mock data on failure.
 *  - SSE job streams (/api/.../stream, Accept: text/event-stream): match NO
 *    route, so Serwist never calls respondWith — they bypass the SW entirely.
 *    (Deliberately no cross-origin/catch-all route, unlike defaultCache.)
 */
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injection point used by createSerwistRoute (InjectManifest).
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Agent-stream guard: EventSource must never be intercepted. */
const isApiStream = (url: URL, request: Request): boolean =>
  url.pathname.includes("/stream") ||
  (request.headers.get("accept") ?? "").includes("text/event-stream");

const runtimeCaching: RuntimeCaching[] = [
  // Hashed build output — immutable, cache-first.
  {
    matcher: /\/_next\/static\/.+/i,
    handler: new CacheFirst({
      cacheName: "next-static",
      plugins: [
        new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      ],
    }),
  },
  // Same-origin static images/fonts (icons, self-hosted next/font files).
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin && /\.(?:png|svg|ico|webp|woff2?|ttf|otf)$/i.test(url.pathname),
    handler: new StaleWhileRevalidate({
      cacheName: "static-assets",
      plugins: [
        new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      ],
    }),
  },
  // API (any origin, /api/*) — network-first, 5s timeout, tiny 5-minute cache.
  // Non-GET requests and SSE streams match nothing and pass straight through.
  // Range requests (the pmtiles protocol's byte-range tile reads against
  // /api/grid/tiles/*) also bypass the SW: the Cache API cannot store 206
  // Partial Content, so intercepting them only adds per-tile latency plus
  // uncaught no-response rejections (observed 2026-08-25).
  {
    matcher: ({ url, request }) =>
      url.pathname.startsWith("/api/") &&
      !isApiStream(url, request) &&
      !request.headers.get("range"),
    method: "GET",
    handler: new NetworkFirst({
      cacheName: "agent-api",
      networkTimeoutSeconds: 5,
      plugins: [
        new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 5 * 60 }),
      ],
    }),
  },
  // RSC payloads + navigations — network-first so the shell works offline.
  {
    matcher: ({ request, sameOrigin, url }) =>
      sameOrigin &&
      !url.pathname.startsWith("/api/") &&
      request.headers.get("RSC") === "1",
    handler: new NetworkFirst({
      cacheName: "pages-rsc",
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
  {
    matcher: ({ request, sameOrigin }) =>
      sameOrigin && request.destination === "document",
    handler: new NetworkFirst({
      cacheName: "pages",
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
  // Remaining same-origin GETs — network-first, modest cache.
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && !url.pathname.startsWith("/api/"),
    method: "GET",
    handler: new NetworkFirst({
      cacheName: "others",
      networkTimeoutSeconds: 10,
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
