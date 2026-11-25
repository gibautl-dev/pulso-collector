import Link from "next/link";
import { Badge, InfoTip, ToneBadge } from "@/components/ui";
import { CopyButton } from "@/components/response-simulator-form";
import { balanceTone } from "@/lib/balance";
import { sourceLabel } from "@/lib/labels";
import {
  RECEPTION_LABEL,
  SEGMENT_HINT,
  SEGMENT_LABEL,
  type Reception,
  type RiskLevel,
  type SimMentionRef,
  type SimSegment,
  type SimSegmentResult,
  type SimTopicStat,
  type SimulationOutput,
} from "@/lib/response-simulator";

const RISK_STYLE: Record<RiskLevel, { label: string; text: string; ring: string; bar: string; soft: string }> = {
  bajo: { label: "Riesgo bajo", text: "text-emerald-700", ring: "ring-emerald-200", bar: "bg-emerald-500", soft: "bg-emerald-50" },
  medio: { label: "Riesgo medio", text: "text-amber-700", ring: "ring-amber-200", bar: "bg-amber-500", soft: "bg-amber-50" },
  alto: { label: "Riesgo alto", text: "text-rose-700", ring: "ring-rose-200", bar: "bg-rose-500", soft: "bg-rose-50" },
};

const RECEPTION_BADGE: Record<Reception, string> = {
  favorable: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  mixta: "bg-amber-50 text-amber-800 ring-amber-600/20",
  desfavorable: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

const SEGMENT_ICON: Record<string, string> = {
  simpatizantes: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z",
  criticos: "M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  medios: "M4 5h13v14H4zM17 8h3v9a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4",
  rival: "M5 19V8h4v11H5zm10 0V4h4v15h-4z",
};

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Etiqueta discreta: la salida es una estimación. */
export function EstimateTag({ windowDays }: { windowDays: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
      Estimación con IA
      <InfoTip
        label="Sobre esta estimación"
        text={`Se apoya en las menciones de los últimos ${windowDays} días. Es una estimación para decidir, no una encuesta ni una predicción.`}
      />
    </span>
  );
}

export function RiskHero({ output, windowDays, rivalName }: { output: SimulationOutput; windowDays: number; rivalName: string | null }) {
  const st = RISK_STYLE[output.risk_level];
  const best = output.segments.find((s) => s.reception === "favorable");
  const worst = output.segments.find((s) => s.reception === "desfavorable");
  return (
    <div data-testid="simulador-riesgo" className="grid gap-4 lg:grid-cols-3">
      <div className={`rounded-xl bg-white p-6 shadow-sm ring-1 ring-inset ${st.ring}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Riesgo general</p>
          <EstimateTag windowDays={windowDays} />
        </div>
        <div className="mt-3 flex items-end gap-2">
          <span className={`text-5xl font-semibold tabular-nums ${st.text}`}>{output.risk_score}</span>
          <span className="pb-1.5 text-sm text-slate-400">/ 100</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-slate-100">
          <div className={`h-2 rounded-full ${st.bar}`} style={{ width: `${Math.max(3, output.risk_score)}%` }} />
        </div>
        <p className={`mt-2 text-sm font-semibold ${st.text}`}>{st.label}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">En una línea</p>
        <p className="mt-2 text-lg font-semibold leading-snug tracking-tight text-slate-900">{output.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {best ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              Mejor recepción: {segmentName(best.key, rivalName)}
            </span>
          ) : null}
          {worst ? (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
              Más resistencia: {segmentName(worst.key, rivalName)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function segmentName(key: string, rivalName: string | null): string {
  if (key === "rival" && rivalName) return `Campo de ${rivalName}`;
  return SEGMENT_LABEL[key as keyof typeof SEGMENT_LABEL] ?? key;
}

export function TopicChips({ topics, detected }: { topics: SimTopicStat[]; detected: boolean }) {
  if (topics.length === 0) return null;
  return (
    <div data-testid="simulador-temas" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">{detected ? "Temas del borrador" : "Temas con más volumen"}</span>
      {topics.map((t) => {
        const tone = balanceTone(t.balance);
        const color = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : "text-slate-600";
        return (
          <span key={t.topic_id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-inset ring-slate-200">
            <span className="font-medium text-slate-800">{t.label}</span>
            <span className="text-slate-400">·</span>
            <span className="tabular-nums text-slate-500">{t.mentions} menc.</span>
            {t.balance != null ? (
              <span className={`tabular-nums font-semibold ${color}`}>
                {t.balance > 0 ? "+" : ""}
                {t.balance}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function shortOutlet(m: SimMentionRef): string {
  const base = (m.outlet || sourceLabel(m.source)).split(/\s[-–:|]\s|:\s/)[0].trim();
  return base.length > 26 ? `${base.slice(0, 25)}…` : base;
}

function MentionQuote({ m }: { m: SimMentionRef }) {
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block rounded-lg border-l-2 border-slate-300 bg-slate-50 px-3 py-2 hover:border-indigo-400 hover:bg-indigo-50/40"
    >
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="font-medium text-slate-700">{shortOutlet(m)}</span>
        <ToneBadge tone={m.tone} />
        <span className="ml-auto font-medium text-indigo-700">Ver original ↗</span>
      </span>
      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-slate-700">“{m.title}”</span>
    </a>
  );
}

export function SegmentCard({
  result,
  segment,
  mentions,
  rivalName,
}: {
  result: SimSegmentResult;
  segment: SimSegment | undefined;
  mentions: Map<string, SimMentionRef>;
  rivalName: string | null;
}) {
  return (
    <section data-testid={`simulador-publico-${result.key}`} className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
            <Icon d={SEGMENT_ICON[result.key]} />
          </span>
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {segmentName(result.key, rivalName)}
              <InfoTip text={SEGMENT_HINT[result.key]} label="Quiénes son" />
            </h3>
            {segment ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {segment.on_topic} menciones en estos temas
                {segment.negative_share != null ? ` · ${segment.negative_share}% negativas` : ""}
              </p>
            ) : null}
          </div>
        </div>
        <Badge className={RECEPTION_BADGE[result.reception]}>{RECEPTION_LABEL[result.reception]}</Badge>
      </header>
      <div className="flex-1 space-y-4 px-5 py-4">
        {result.reception_text ? <p className="text-sm leading-relaxed text-slate-700">{result.reception_text}</p> : null}
        {result.risks.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Riesgos</p>
            <ul className="mt-1.5 space-y-1">
              {result.risks.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.counter_arguments.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lo que te pueden contestar</p>
            <ul className="mt-1.5 space-y-3">
              {result.counter_arguments.map((c, i) => {
                const first = c.refs.map((r) => mentions.get(r)).find(Boolean);
                return (
                  <li key={i}>
                    <p className="text-sm font-medium text-slate-800">{c.text}</p>
                    {first ? <MentionQuote m={first} /> : null}
                    {c.refs.length > 1 ? (
                      <p className="mt-1 text-[11px] text-slate-400">
                        +{c.refs.length - 1} mención{c.refs.length - 1 === 1 ? "" : "es"} en la misma línea
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      {result.tweaks.length > 0 ? (
        <div className="rounded-b-xl border-t border-slate-100 bg-indigo-50/40 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Ajustes sugeridos</p>
          <ul className="mt-1.5 space-y-1">
            {result.tweaks.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700">
                <span className="text-indigo-500">→</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function SuggestedVersion({ text }: { text: string }) {
  if (!text) return null;
  return (
    <section data-testid="simulador-version" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Versión con los ajustes</h3>
        <CopyButton text={text} />
      </div>
      <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">{text}</p>
      <p className="mt-2 text-xs text-slate-500">Para revisar y editar. Pulso no la publica.</p>
    </section>
  );
}

export function HistoryList({
  slug,
  items,
  activeId,
  formatTime,
}: {
  slug: string;
  items: { id: string; draft: string; created_at: string; risk: SimulationOutput | null; status: string }[];
  activeId: string | null;
  formatTime: (iso: string) => string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no simulaste nada.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => {
        const st = it.risk ? RISK_STYLE[it.risk.risk_level] : null;
        return (
          <li key={it.id}>
            <Link
              href={`/c/${slug}/simulador?sim=${it.id}`}
              aria-current={it.id === activeId ? "page" : undefined}
              className={`-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50 ${it.id === activeId ? "bg-indigo-50/60" : ""}`}
            >
              <span
                className={`mt-0.5 inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${
                  st ? `${st.soft} ${st.text}` : "bg-slate-100 text-slate-400"
                }`}
              >
                {it.risk ? it.risk.risk_score : "–"}
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm text-slate-700">{it.draft}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {formatTime(it.created_at)}
                  {it.status === "error" ? " · sin resultado" : ""}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
