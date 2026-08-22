/**
 * The red→green solar-probability ramp. DATA-VIZ ONLY: these colors paint the
 * parcel map layer and the sheet's score accent — they are never UI status
 * colors (status stays on the band system in lib/band.ts: grey/orange).
 * Same stops as the production MapLibre `interpolate` expression and the
 * mobile mockup's contracts/colors.ts — one ramp across web + mobile.
 */

const STOPS: Array<[number, string]> = [
  [0, "#d7191c"],
  [25, "#fdae61"],
  [50, "#ffffbf"],
  [75, "#a6d96a"],
  [100, "#1a9641"],
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Interpolated ramp color for a 0..100 score. */
export function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  let lo = STOPS[0];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (s >= STOPS[i][0] && s <= STOPS[i + 1][0]) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const t = lo[0] === hi[0] ? 0 : (s - lo[0]) / (hi[0] - lo[0]);
  const a = hexToRgb(lo[1]);
  const b = hexToRgb(hi[1]);
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Human verdict for a score — legend endpoints and sheet label. */
export function scoreVerdict(score: number): string {
  if (score <= 0) return "No-go";
  if (score < 25) return "Poor";
  if (score < 50) return "Marginal";
  if (score < 75) return "Promising";
  return "Go";
}

/** CSS linear-gradient through the five ramp stops (legend bar). */
export const RAMP_GRADIENT_CSS = `linear-gradient(to right, ${STOPS.map(
  ([pos, hex]) => `${hex} ${pos}%`,
).join(", ")})`;

export const NO_DATA_COLOR = "#d8d6e2";
