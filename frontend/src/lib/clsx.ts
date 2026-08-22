// Tiny classname joiner — avoids a dependency for a one-line utility.
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[];

export function clsx(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (Array.isArray(v)) {
      const nested = clsx(...v);
      if (nested) out.push(nested);
    } else {
      out.push(String(v));
    }
  }
  return out.join(" ");
}
