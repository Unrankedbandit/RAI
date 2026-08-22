/**
 * FROZEN — the red→green probability ramp (research report 02 §c).
 * Same stops as the production MapLibre `interpolate` expression.
 * Map data-viz only — never use ramp colors for UI status (brand uses orange/grey).
 * Luminance rises monotonically toward green as a colorblind-safety mitigation (report 05).
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

/** Human verdict for a score — used in sheet + legend. */
export function scoreVerdict(score: number): string {
  if (score <= 0) return "No-go";
  if (score < 25) return "Poor";
  if (score < 50) return "Marginal";
  if (score < 75) return "Promising";
  return "Go";
}

export const NO_DATA_COLOR = "#d8d6e2";
