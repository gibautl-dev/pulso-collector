import type { ComparisonDay } from "@/lib/rivals";
import { DEFAULT_CLOCK, formatDayShort, type Clock } from "@/lib/time";

export function ComparisonVolumeChart({
  data,
  candidateName,
  rivalName,
  clock = DEFAULT_CLOCK,
}: {
  data: ComparisonDay[];
  candidateName: string;
  rivalName: string;
  clock?: Clock;
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.candidate, d.rival)));
  return (
    <div>
      <div className="flex h-48 items-end gap-2" role="img" aria-label="Volumen diario frente al rival">
        {data.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
            <div
              className="w-1/2 max-w-4 rounded-t-sm bg-indigo-600"
              style={{ height: `${(d.candidate / max) * 90}%` }}
              title={`${formatDayShort(d.day, clock)} · ${candidateName}: ${d.candidate}`}
            />
            <div
              className="w-1/2 max-w-4 rounded-t-sm bg-slate-400"
              style={{ height: `${(d.rival / max) * 90}%` }}
              title={`${formatDayShort(d.day, clock)} · ${rivalName}: ${d.rival}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
        {data.map((d) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500">
            {formatDayShort(d.day, clock)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-600" /> {candidateName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> {rivalName}
        </span>
      </div>
    </div>
  );
}
