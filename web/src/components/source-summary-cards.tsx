import Link from "next/link";
import type { HomeSourceCard } from "@/lib/home-summaries";

export function SourceSummaryCards({ cards }: { cards: HomeSourceCard[] }) {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/30"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{card.title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{card.hint}</p>
            </div>
            <span className="shrink-0 text-xs font-medium text-indigo-600 group-hover:text-indigo-500">Ver →</span>
          </div>
          {card.insufficient ? (
            <p className="mt-4 text-sm text-slate-500">{card.emptyLabel}</p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {card.stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{stat.label}</dt>
                  <dd
                    className={`mt-0.5 text-sm font-semibold tabular-nums ${
                      card.tone === "negative" && stat.label.toLowerCase().includes("balance")
                        ? "text-rose-600"
                        : card.tone === "positive" && stat.label.toLowerCase().includes("balance")
                          ? "text-emerald-600"
                          : "text-slate-900"
                    }`}
                  >
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {card.caveat ? <p className="mt-4 text-xs leading-relaxed text-slate-500">{card.caveat}</p> : null}
        </Link>
      ))}
    </div>
  );
}
