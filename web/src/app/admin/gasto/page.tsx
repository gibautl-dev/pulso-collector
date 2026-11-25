import { AiCapForm } from "@/components/ai-cap-form";
import { Badge, Card, EmptyState, InfoTip, PageHeader, Stat } from "@/components/ui";
import { saveAiVisibilityCapAction } from "./actions";
import { requireStaff } from "@/lib/context";
import {
  CLASSIFIER_EST_USD_PER_MENTION,
  INFRA,
  X_USD_PER_POST,
  X_USD_PER_USER,
  fmtNum,
  fmtUsd,
  monthToDate,
  summarizeSpend,
  type FeatureTotal,
  type SpendSummary,
} from "@/lib/spend";

export const metadata = { title: "Gasto · Panel Active · Pulso" };

const BASIS_BADGE: Record<string, string> = {
  registrado: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  EST: "bg-amber-50 text-amber-800 ring-amber-200",
  CALC: "bg-sky-50 text-sky-700 ring-sky-200",
  "sin dato": "bg-slate-50 text-slate-500 ring-slate-200",
};

function BasisBadge({ basis }: { basis: string }) {
  return <Badge className={BASIS_BADGE[basis] ?? BASIS_BADGE["sin dato"]}>{basis}</Badge>;
}

function shortDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function DailyChart({ summary }: { summary: SpendSummary }) {
  const max = Math.max(0.0001, ...summary.days.map((d) => d.recorded + d.estimated));
  return (
    <div>
      <div className="flex h-52 items-end gap-1" role="img" aria-label="Gasto de IA por día">
        {summary.days.map((d) => {
          const total = d.recorded + d.estimated;
          return (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[9px] tabular-nums text-slate-500">{total >= 0.01 ? fmtNum(total, 2) : ""}</span>
              <div
                className="flex w-full max-w-8 flex-col justify-end overflow-hidden rounded-t-md"
                style={{ height: `${(total / max) * 85}%` }}
                title={`${shortDay(d.day)}: ${fmtUsd(d.recorded)} registrado + ${fmtUsd(d.estimated)} EST`}
              >
                <div className="w-full bg-amber-300" style={{ height: total ? `${(d.estimated / total) * 100}%` : 0 }} />
                <div className="w-full bg-indigo-500" style={{ height: total ? `${(d.recorded / total) * 100}%` : 0 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1 border-t border-slate-100 pt-2">
        {summary.days.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center text-[9px] text-slate-500">
            {i % 2 === 0 || summary.days.length <= 16 ? shortDay(d.day) : ""}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" /> Registrado por la app</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> Clasificador (EST)</span>
      </div>
    </div>
  );
}

function CapMeter({ f }: { f: FeatureTotal }) {
  if (f.dailyCapUsd == null || f.dailyCapUsd <= 0) {
    return <span className="text-xs text-slate-500">{f.capText}</span>;
  }
  const pct = Math.min(100, (f.todayUsd / f.dailyCapUsd) * 100);
  const color = pct >= 90 ? "bg-rose-500" : pct >= 60 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="min-w-32">
      <div className="mb-1 flex justify-between gap-2 text-[11px] text-slate-500">
        <span>Hoy {fmtUsd(f.todayUsd)}</span>
        <span>{f.capText}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: f.todayUsd > 0 ? `${Math.max(3, pct)}%` : 0 }} />
      </div>
    </div>
  );
}

export default async function AdminGastoPage() {
  const { repo } = await requireStaff();
  const { from, to } = monthToDate(await repo.dataTimestamp());
  const report = await repo.getSpendReport(from, to);

  if (!report) {
    return (
      <>
        <PageHeader title="Gasto de la app" description="Costos de IA, uso de la API de X e infraestructura." />
        <Card>
          <EmptyState>
            Falta activar el resumen de gasto en la base (deploy/spend_panel.sql). Hasta entonces no hay datos para mostrar.
          </EmptyState>
        </Card>
      </>
    );
  }

  const s = summarizeSpend(report);
  const maxCand = Math.max(0.0001, ...s.candidates.map((c) => c.recorded + c.estimated + c.x));
  const knownInfra = INFRA.filter((i) => i.monthlyUsd != null);
  const generated = new Date(report.generated_at).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      <PageHeader
        title="Gasto de la app"
        description={`Mes en curso: ${s.monthLabel} (del 1 al ${Number(to.slice(8))}). Datos al ${generated}, hora de Buenos Aires.`}
      >
        <div className="flex flex-wrap gap-2 text-xs">
          <BasisBadge basis="registrado" />
          <span className="text-slate-500">guardado por la app</span>
          <BasisBadge basis="EST" />
          <span className="text-slate-500">estimado</span>
          <BasisBadge basis="CALC" />
          <span className="text-slate-500">calculado</span>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="IA · mes en curso"
          value={fmtUsd(s.aiTotalUsd)}
          hint={<>{fmtUsd(s.recordedUsd)} registrado · {fmtUsd(s.estimatedUsd)} EST</>}
          info="Suma de lo que cada función guardó como costo del modelo, más el clasificador de menciones estimado con lo medido en los logs."
        />
        <Stat
          label="API de X · CALC"
          value={fmtUsd(s.xUsd)}
          hint={<>{fmtNum(s.xPostsTotal, 0)} posts leídos</>}
          info={`Posts devueltos × USD ${fmtNum(X_USD_PER_POST, 3)} (precio oficial de lectura). No incluye USD ${fmtNum(X_USD_PER_USER, 3)} por usuario de la expansión, que el recolector no cuenta, ni la deduplicación diaria de X.`}
        />
        <Stat
          label="Proyección del mes · CALC"
          value={fmtUsd(s.projectionUsd)}
          hint={<>IA + X · {fmtUsd(s.dailyRateUsd)}/día</>}
          info={`Lo gastado hasta hoy más el promedio de los últimos 7 días completos por los ${s.daysInMonth - s.daysElapsed} días que faltan. No incluye infraestructura.`}
        />
        <Stat
          label="Infraestructura fija"
          value={`${fmtUsd(s.infraMonthlyUsd)}/mes`}
          hint={<>{knownInfra.length} de {INFRA.length} con dato · cron no disponible</>}
          info="Planes leídos de Render y Supabase. El cron de Render se cobra por segundo y su costo no está disponible por API."
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="IA por día" subtitle="USD por día, hora de Buenos Aires" className="lg:col-span-2">
          <div className="p-5">
            <DailyChart summary={s} />
          </div>
        </Card>
        <Card title="Por candidato" subtitle="IA + X en el mes">
          <div className="space-y-4 p-5">
            {s.candidates.length ? (
              s.candidates.map((c) => {
                const total = c.recorded + c.estimated + c.x;
                return (
                  <div key={c.candidate_id ?? "none"}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate text-slate-700">{c.name}</span>
                      <span className="shrink-0 font-medium tabular-nums text-slate-900">{fmtUsd(total)}</span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-indigo-500" style={{ width: `${(c.recorded / maxCand) * 100}%` }} />
                      <div className="bg-amber-300" style={{ width: `${(c.estimated / maxCand) * 100}%` }} />
                      <div className="bg-sky-400" style={{ width: `${(c.x / maxCand) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      IA {fmtUsd(c.recorded + c.estimated)} · X {fmtUsd(c.x)}
                    </p>
                  </div>
                );
              })
            ) : (
              <EmptyState>Sin gasto este mes.</EmptyState>
            )}
            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-indigo-500" /> IA registrado</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-300" /> Clasificador EST</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400" /> X CALC</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Por función" subtitle="Mes en curso y uso de hoy contra el tope" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2 font-medium">Función</th>
                <th className="px-3 py-2 text-right font-medium">Usos</th>
                <th className="px-3 py-2 text-right font-medium">Mes</th>
                <th className="px-3 py-2 font-medium">Dato</th>
                <th className="px-5 py-2 font-medium">Hoy y tope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.features.map((f) => (
                <tr key={f.feature} className={f.items === 0 ? "text-slate-400" : ""}>
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-1.5 font-medium text-slate-800">
                      {f.label}
                      {f.info ? <InfoTip text={f.info} /> : null}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(f.items, 0)}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-900">
                    {f.basis === "sin dato" ? "—" : fmtUsd(f.usd)}
                  </td>
                  <td className="px-3 py-2.5"><BasisBadge basis={f.basis} /></td>
                  <td className="px-5 py-2.5"><CapMeter f={f} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.aiCaps.length ? (
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-4" data-testid="ai-caps">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              Tope diario de En la IA por candidato
              <InfoTip text="Cada candidato cuenta solo su propio gasto del día (hora de Buenos Aires). Antes de cada pregunta se reserva el costo de una respuesta; si no entra, ese candidato no pregunta más ese día y su cliente ve un aviso amable en En la IA." />
            </p>
            <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {s.aiCaps.map((c) => {
                const pct = c.capUsd > 0 ? Math.min(100, (c.todayUsd / c.capUsd) * 100) : 100;
                const color = pct >= 90 ? "bg-rose-500" : pct >= 60 ? "bg-amber-400" : "bg-emerald-500";
                return (
                  <li key={c.candidate_id} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{c.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {c.reachedOn ? `Tope alcanzado por última vez: ${shortDay(c.reachedOn)}` : "Todavía no alcanzó el tope"}
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between gap-2 text-[11px] text-slate-500">
                        <span>Hoy {fmtUsd(c.todayUsd)}</span>
                        <span>de {fmtUsd(c.capUsd)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div className={`h-1.5 rounded-full ${color}`} style={{ width: c.todayUsd > 0 ? `${Math.max(3, pct)}%` : 0 }} />
                      </div>
                    </div>
                    <AiCapForm
                      action={saveAiVisibilityCapAction}
                      current={c.capUsd}
                      candidateId={c.candidate_id}
                      candidateName={c.name}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Clasificador: USD {fmtNum(CLASSIFIER_EST_USD_PER_MENTION, 6)} por mención (EST, medido en los logs del cron del 25/11). Clasificación de anuncios: no guarda costo y no hay medición, por eso figura sin dato.
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="API de X por día"
          subtitle="Posts leídos contra el cupo diario (el cupo se reinicia a las 21:00)"
          className="lg:col-span-2"
        >
          <div className="space-y-3 p-5">
            {s.xDays.length ? (
              s.xDays.map((d) => (
                <div key={d.date}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-slate-700">{shortDay(d.date)}</span>
                    <span className="tabular-nums text-slate-900">
                      {fmtNum(d.posts, 0)} / {fmtNum(d.maxPosts, 0)} posts · {d.requests}/{d.maxRequests} pedidos ·{" "}
                      <span className="text-slate-500">{fmtUsd(d.usd)}</span>
                    </span>
                  </div>
                  <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100">
                    {d.byCandidate.map((c, i) => (
                      <div
                        key={c.candidate_id}
                        className={i % 2 === 0 ? "bg-sky-500" : "bg-sky-300"}
                        style={{ width: `${(c.posts / d.maxPosts) * 100}%` }}
                        title={`${c.name}: ${c.posts}/${c.maxPosts} posts, ${c.requests}/${c.maxRequests} pedidos`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {d.byCandidate
                      .map((c) => `${c.name} ${c.posts} posts${c.requests >= c.maxRequests ? " (cupo de pedidos lleno)" : ""}`)
                      .join(" · ")}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState>Sin lecturas de X este mes.</EmptyState>
            )}
          </div>
        </Card>
        <Card title="Infraestructura" subtitle="Planes fijos por mes">
          <ul className="divide-y divide-slate-100">
            {INFRA.map((i) => (
              <li key={i.name} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    {i.name}
                    <InfoTip text={i.note} />
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
                    {i.monthlyUsd == null ? "No disponible" : fmtUsd(i.monthlyUsd)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {i.plan} · {i.basis}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
