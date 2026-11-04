import type { DayVolume } from "@/lib/analytics";
import { formatDayShort } from "@/lib/time";

const SERIES = [
  { key: "negativo", label: "Negativas sobre él", cls: "bg-rose-500" },
  { key: "positivo", label: "A favor", cls: "bg-emerald-500" },
  { key: "neutral", label: "Informativas / otros", cls: "bg-slate-300" },
  { key: "pendiente", label: "Sin clasificar", cls: "bg-slate-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(148,163,184,.5)_3px,rgba(148,163,184,.5)_5px)]" },
] as const;

export function VolumeChart({ data }: { data: DayVolume[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div>
      <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Menciones por día">
        {data.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] tabular-nums text-slate-500">{d.total || ""}</span>
            <div
              className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md"
              style={{ height: `${(d.total / max) * 85}%` }}
              title={`${formatDayShort(d.day)}: ${d.total} menciones`}
            >
              {SERIES.map((s) =>
                d[s.key] > 0 ? <div key={s.key} className={s.cls} style={{ height: `${(d[s.key] / d.total) * 100}%` }} /> : null,
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-slate-100 pt-2">
        {data.map((d) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500">
            {formatDayShort(d.day)}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
