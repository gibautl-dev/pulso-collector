import type { AdsVolumePoint } from "@/lib/meta-ads";

export function AdsVolumeChart({ data, label }: { data: AdsVolumePoint[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div>
      <div className="flex h-48 items-end gap-1.5" role="img" aria-label={label}>
        {data.map((d) => (
          <div key={d.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] tabular-nums text-slate-500">{d.total || ""}</span>
            <div
              className="w-full max-w-10 overflow-hidden rounded-t-md bg-indigo-500"
              style={{ height: `${(d.total / max) * 85}%` }}
              title={`${d.label}: ${d.total} anuncios`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-slate-100 pt-2">
        {data.map((d) => (
          <span key={d.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
