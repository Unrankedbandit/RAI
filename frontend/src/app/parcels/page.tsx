import type { Metadata } from "next";
import { ParcelViewerClient } from "@/components/parcels/ParcelViewerClient";

export const metadata: Metadata = {
  title: "California Parcel Viewer",
};

/**
 * /parcels — full-height California parcel viewer: Regrid boundary tiles over
 * a Positron basemap, click-to-identify against county open-GIS endpoints and
 * the CA DWR statewide mosaic.
 * The layout's <main> is flex-1 min-h-0 beneath the 57px TopBar, so h-full
 * here is exactly viewport-minus-header.
 */
export default function ParcelsPage() {
  return (
    <div className="h-full">
      <ParcelViewerClient />
    </div>
  );
}
