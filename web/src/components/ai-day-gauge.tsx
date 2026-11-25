import { formatBalance } from "@/lib/ai-visibility";

/** Semicírculo de −100 (izquierda, rosa) a +100 (derecha, verde). */
export function AiDayGauge({ balance }: { balance: number | null }) {
  const width = 320;
  const height = 190;
  const cx = 160;
  const cy = 150;
  const r = 110;
  const arc = (start: number, end: number, color: string) => {
    const a0 = Math.PI + (start / 200) * Math.PI;
    const a1 = Math.PI + (end / 200) * Math.PI;
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const large = end - start > 100 ? 1 : 0;
    return <path d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`} fill="none" stroke={color} strokeWidth="18" strokeLinecap="butt" />;
  };
  const value = balance == null ? 0 : Math.max(-100, Math.min(100, balance));
  const angle = Math.PI + ((value + 100) / 200) * Math.PI;
  const nx = cx + Math.cos(angle) * (r - 8);
  const ny = cy + Math.sin(angle) * (r - 8);
  const tone = balance == null ? "text-slate-400" : balance > 5 ? "text-emerald-600" : balance < -5 ? "text-rose-600" : "text-slate-800";

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label="Balance del día">
        {arc(0, 70, "#fda4af")}
        {arc(70, 130, "#e2e8f0")}
        {arc(130, 200, "#6ee7b7")}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="8" fill="#0f172a" />
        <text x={cx - r - 4} y={cy + 24} fontSize="11" fill="#94a3b8" textAnchor="start">
          −100
        </text>
        <text x={cx + r + 4} y={cy + 24} fontSize="11" fill="#94a3b8" textAnchor="end">
          +100
        </text>
      </svg>
      <p className={`-mt-6 text-4xl font-semibold tabular-nums ${tone}`}>{balance == null ? "—" : formatBalance(balance)}</p>
      <p className="mt-1 text-xs text-slate-500">de −100 a +100</p>
    </div>
  );
}
