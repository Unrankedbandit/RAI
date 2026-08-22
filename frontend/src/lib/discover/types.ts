/** Discovery-layer types — local to the parcel discovery surface (/discover). */

export type DiscoverLayerId = "score" | "slope" | "flood" | "fire";

export interface ParcelDrivers {
  /** 0..1 sub-scores composing the total — rendered as the "why" bars. */
  openSpace: number;
  buildingFreedom: number;
  acreageFit: number;
}

export interface Parcel {
  id: string;
  apn: string;
  county: string;
  address: string;
  /** Undefined = masked / hidden by default (legal guidance). */
  owner?: string;
  acres: number;
  /** 0..100 solar-development probability. 0 = no-go, 100 = go. */
  score: number;
  zoning: string;
  scoredAt: string;
  drivers: ParcelDrivers;
  /** SVG path data in the shared 1000x1000 mock-map coordinate space. */
  path: string;
}
