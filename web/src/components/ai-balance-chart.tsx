import type { AiDayScore } from "@/lib/types";
import { formatBalance } from "@/lib/ai-visibility";
import { DEFAULT_CLOCK, formatDayShort, type Clock } from "@/lib/time";

export function AiBalanceChart({ data, clock = DEFAULT_CLOCK }: { data: AiDayScore[]; clock?: Clock }) {
  if (data.length === 0) return null;
  const max = Math.max(20, ...data.map((d) => Math.abs(d.balance)));
  return (
    <div>
      <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Evolución diaria del balance en IA">
        {data.map((d) => {
          const positive = d.balance >= 0;
          const height = Math.max(4, (Math.abs(d.balance) / max) * 85);
          return (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className={`text-[10px] tabular-nums ${positive ? "text-emerald-700" : "text-rose-700"}`}>
                {formatBalance(d.balance)}
              </span>
              <div className="flex h-[85%] w-full max-w-10 flex-col justify-end">
                <div
                  className={`w-full rounded-t-md ${positive ? "bg-emerald-500" : "bg-rose-500"}`}
                  style={{ height: `${height}%` }}
                  title={`${formatDayShort(d.day, clock)}: ${formatBalance(d.balance)}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-slate-100 pt-2">
        {data.map((d) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500">
            {formatDayShort(d.day, clock)}
          </span>
        ))}
      </div>
    </div>
  );
}
