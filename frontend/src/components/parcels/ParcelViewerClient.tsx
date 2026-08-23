"use client";

import dynamic from "next/dynamic";
import { MapIntroPopup } from "./MapIntroPopup";

/**
 * Client-only entry for the parcel viewer. MapLibre needs the browser, so the
 * heavy viewer is loaded via next/dynamic with ssr:false — the same wrapper
 * pattern as portfolio/PortfolioMap.tsx (the dynamic()+ssr:false pair is not
 * allowed in a Server Component, so it lives here, not in app/parcels/page).
 */
const ParcelViewer = dynamic(() => import("./ParcelViewer"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-2" />,
});

export function ParcelViewerClient() {
  return (
    <div className="relative h-full w-full">
      <ParcelViewer />
      <MapIntroPopup />
    </div>
  );
}
