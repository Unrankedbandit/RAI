// Timeline date rendering. Adapters fabricate a first-of-period ISO date from
// vague source strings ("Sep 2027" -> 2027-09-01) so events sort on a shared
// axis; `datePrecision` records how much of that date is real. Rendering must
// honor it: a month-precision date shown as "Sep 1, 2027" invents a day the
// source never stated.

import type { DatePrecision, TimelineEvent } from "./types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The honest date label for a timeline event. Prefers the adapter's
 * `dateDisplay` (already precision-aware); without one, formats the ISO date
 * at the stated precision — "Sep 2027" / "Q3 2027" / "2027" — instead of the
 * raw first-of-period date. Day precision (or no precision metadata, e.g.
 * hand-written mock data) falls back to the ISO string, as before.
 */
export function eventDateLabel(
  event: Pick<TimelineEvent, "date"> & {
    dateDisplay?: string;
    datePrecision?: DatePrecision;
  },
): string {
  if (event.dateDisplay) return event.dateDisplay;
  const [y, m] = event.date.split("-");
  const month = Number.parseInt(m, 10);
  if (month >= 1 && month <= 12) {
    if (event.datePrecision === "month") return `${MONTHS[month - 1]} ${y}`;
    if (event.datePrecision === "quarter") {
      return `Q${Math.floor((month + 2) / 3)} ${y}`;
    }
  }
  if (event.datePrecision === "year") return y;
  return event.date;
}
