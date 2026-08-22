import { Chip } from "@/components/ui/Chip";

export type QueueFilter = "all" | "needs-action" | "high";

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-action", label: "Needs action" },
  { id: "high", label: "High priority" },
];

type QueueToolbarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  filter: QueueFilter;
  onFilterChange: (f: QueueFilter) => void;
  resultCount: number;
};

/** Search + filter chips + live result count for the findings queue. */
export function QueueToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  resultCount,
}: QueueToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search title, key, workstream, project…"
        aria-label="Search findings"
        className="w-[240px] rounded-full bg-canvas px-3.5 py-1.5 text-sm text-ink ring-1 ring-hairline placeholder:text-faint focus:outline-none focus:ring-oxford"
      />
      {FILTERS.map((f) => (
        <Chip
          key={f.id}
          active={filter === f.id}
          onClick={() => onFilterChange(f.id)}
        >
          {f.label}
        </Chip>
      ))}
      <span className="ml-auto text-[12.5px] text-faint">
        {resultCount} {resultCount === 1 ? "finding" : "findings"}
      </span>
    </div>
  );
}
