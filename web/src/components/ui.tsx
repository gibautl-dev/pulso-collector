import type { ReactNode } from "react";
import { RELEVANCE_BADGE, RELEVANCE_LABEL, RUN_STATUS_BADGE, RUN_STATUS_LABEL, TONE_BADGE, TONE_LABEL } from "@/lib/labels";
import type { Relevance, RunStatus, Tone } from "@/lib/types";

export function Card({ title, subtitle, children, className = "", action }: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      {children}
    </span>
  );
}

export function ToneBadge({ tone }: { tone: Tone | null }) {
  if (!tone) return <Badge className="bg-white text-slate-400 ring-slate-200 italic">Sin clasificar</Badge>;
  return <Badge className={TONE_BADGE[tone]}>{TONE_LABEL[tone]}</Badge>;
}

export function RelevanceBadge({ relevance }: { relevance: Relevance | null }) {
  if (!relevance) return null;
  return <Badge className={RELEVANCE_BADGE[relevance]}>Relevancia {RELEVANCE_LABEL[relevance].toLowerCase()}</Badge>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge className={RUN_STATUS_BADGE[status]}>{RUN_STATUS_LABEL[status]}</Badge>;
}

export function Stat({ label, value, hint, tone = "default" }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "negative" | "positive";
}) {
  const color = tone === "negative" ? "text-rose-600" : tone === "positive" ? "text-emerald-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

/** Barra horizontal simple. */
export function HBar({ label, value, max, barClass = "bg-indigo-500", extra }: {
  label: ReactNode;
  value: number;
  max: number;
  barClass?: string;
  extra?: ReactNode;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-900">
          {value}
          {extra}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${barClass}`} style={{ width: value > 0 ? `${pct}%` : 0 }} />
      </div>
    </div>
  );
}
