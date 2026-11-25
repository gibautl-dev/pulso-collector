import type { DayVolume } from "@/lib/analytics";
import { volumePeak } from "@/lib/volume-peak";
import { DEFAULT_CLOCK, formatDayShort, type Clock } from "@/lib/time";

export function VolumeChart({ data, clock = DEFAULT_CLOCK }: { data: DayVolume[]; clock?: Clock }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const peak = volumePeak(data);
  const width = 640;
  const height = 220;
  const padL = 24;
  const padR = 36;
  const padT = 48;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(1, data.length);
  const xFor = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (v: number) => padT + innerH - (v / max) * innerH;
  const points = data.map((d, i) => `${xFor(i)},${yFor(d.total)}`).join(" ");
  const area = `${xFor(0)},${yFor(0)} ${points} ${xFor(n - 1)},${yFor(0)}`;
  const peakIndex = peak ? data.findIndex((d) => d.day === peak.day) : -1;

  if (data.length === 0) return null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full overflow-visible"
        role="img"
        aria-label="Volumen de menciones por día"
      >
        <defs>
          <linearGradient id="pulso-volume-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#pulso-volume-fill)" />
        <polyline points={points} fill="none" stroke="#6d28d9" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => {
          const x = xFor(i);
          const y = yFor(d.total);
          const isPeak = i === peakIndex;
          return (
            <g key={d.day}>
              <title>{`${formatDayShort(d.day, clock)}: ${d.total} menciones`}</title>
              <circle cx={x} cy={y} r={isPeak ? 6 : 5} fill="#fff" stroke="#6d28d9" strokeWidth="2.5" />
              {d.total > 0 ? (
                <text x={x} y={y - 12} textAnchor="middle" className="fill-slate-700" fontSize="11" fontWeight={isPeak ? 700 : 500}>
                  {d.total.toLocaleString("es-AR")}
                </text>
              ) : null}
              {isPeak && peak ? (
                <g transform={`translate(${x < 90 ? x + 14 : Math.min(Math.max(x - 38, 4), width - 86)}, ${Math.max(6, y - 48)})`}>
                  <rect width="76" height="22" rx="11" fill="#e11d48" />
                  <text x="38" y="15" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">
                    {peak.percent == null ? "PICO" : `PICO +${peak.percent}%`}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-1.5">
        {data.map((d) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500">
            {formatDayShort(d.day, clock)}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        La píldora PICO compara el día más alto con el promedio de los demás días del período
        (incluye días en cero). Se muestra a partir de un 15% por encima de ese promedio.
        Si el resto está en cero, se etiqueta PICO sin porcentaje (no se divide por cero).
      </p>
    </div>
  );
}
