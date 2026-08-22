import { Card } from "@/components/ui/Card";

export type Stat = {
  value: string | number;
  label: string;
};

/** Three headline portfolio numbers, each with a one-line label. */
export function StatBoxes({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {stats.map((s) => (
        <Card key={s.label}>
          <p className="text-3xl font-semibold leading-none text-ink tabular-nums">
            {s.value}
          </p>
          <p className="mt-2 text-sm text-muted">{s.label}</p>
        </Card>
      ))}
    </div>
  );
}
