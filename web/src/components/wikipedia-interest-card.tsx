import { Card } from "@/components/ui";
import {
  WIKIMEDIA_ATTRIBUTION,
  formatDayLabel,
  formatViews,
  type WikipediaInterest,
} from "@/lib/wikipedia-pageviews";

export function WikipediaInterestCard({ interest }: { interest: WikipediaInterest }) {
  const change = interest.changePercent;
  const changeLabel =
    change == null
      ? interest.previousViews == null
        ? "Sin semana anterior para comparar"
        : "Sin variación comparable"
      : `${change > 0 ? "+" : ""}${change}% frente a la semana anterior`;
  const changeClass =
    change == null ? "text-slate-500" : change > 0 ? "text-emerald-700" : change < 0 ? "text-rose-700" : "text-slate-600";
  const max = Math.max(1, ...interest.series.map((p) => p.views));
  const width = 160;
  const height = 36;
  const points = interest.series.map((p, i) => {
    const x = interest.series.length === 1 ? width / 2 : (i / (interest.series.length - 1)) * width;
    const y = height - (p.views / max) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <Card
      testId="tablero-wikipedia"
      className="mt-6"
      title="Interés en Wikipedia"
      info={WIKIMEDIA_ATTRIBUTION.tip}
      action={
        <a
          href={interest.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
        >
          Ver página
        </a>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{formatViews(interest.lastViews)}</p>
          <p className="mt-1 text-sm text-slate-600">visitas el {formatDayLabel(interest.lastDay)}</p>
          <p className={`mt-1 text-sm ${changeClass}`}>{changeLabel}</p>
        </div>
        {interest.series.length > 1 ? (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="text-indigo-600">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points.join(" ")}
            />
          </svg>
        ) : null}
        {/* InfoTip also available on the title; keep a visible credit in the tooltip only. */}
        <span className="sr-only">{WIKIMEDIA_ATTRIBUTION.name}</span>
      </div>
    </Card>
  );
}
