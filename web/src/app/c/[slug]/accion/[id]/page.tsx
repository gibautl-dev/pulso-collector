import Link from "next/link";
import { notFound } from "next/navigation";
import { CrisisStatusForm, DraftBlock } from "@/components/crisis-actions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { loadCandidate } from "@/lib/context";
import {
  CRISIS_RISK_BADGE,
  CRISIS_RISK_LABEL,
  CRISIS_STATUS_BADGE,
  CRISIS_STATUS_LABEL,
  CRISIS_TRIGGER_LABEL,
} from "@/lib/labels";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: "Brief de acción · Pulso" };

export default async function AccionBriefPage({ params }: PageProps<"/c/[slug]/accion/[id]">) {
  const { slug, id } = await params;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const alert = await repo.getCrisisAlert(candidate.id, id);
  if (!alert) notFound();
  const briefs = await repo.listCrisisBriefs(candidate.id, alert.id);
  const brief = briefs[0] ?? alert.latest_brief ?? null;
  const output = brief?.output ?? {};
  const analyst = output.analyst ?? {};
  const evidence = output.evidence ?? {};
  const options = output.strategist?.options ?? [];
  const drafts = output.writer?.drafts ?? [];
  const title = brief?.title || output.title || alert.cluster_label || "Brief de acción";
  const risk = String(brief?.risk_level || output.risk_level || alert.severity);

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href={`/c/${slug}/accion`} className="text-indigo-700 hover:underline">
          ← Bandeja de Acción
        </Link>
      </p>
      <PageHeader
        title={title}
        description={`${CRISIS_TRIGGER_LABEL[alert.trigger_type] ?? alert.trigger_type}. Ventana ${formatDateTime(alert.window_start, clock)} – ${formatDateTime(alert.window_end, clock)} (${clock.tzLabel}).`}
      >
        <div className="flex flex-wrap gap-2">
          <Badge className={CRISIS_STATUS_BADGE[alert.status] ?? ""}>
            {CRISIS_STATUS_LABEL[alert.status] ?? alert.status}
          </Badge>
          <Badge className={CRISIS_RISK_BADGE[risk] ?? ""}>{CRISIS_RISK_LABEL[risk] ?? risk}</Badge>
        </div>
      </PageHeader>

      <div className="space-y-6">
        <Card title="Coordinador" subtitle="Listo para una persona. Pulso no publica ni postea.">
          {output.summary ? <p className="text-sm leading-6 text-slate-700">{output.summary}</p> : (
            <p className="text-sm text-slate-500">Todavía no hay un brief armado para esta alerta.</p>
          )}
          {alert.status_note ? (
            <p className="mt-3 text-xs text-slate-500">Nota del equipo: {alert.status_note}</p>
          ) : null}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <CrisisStatusForm slug={slug} id={alert.id} current={alert.status} />
          </div>
        </Card>

        <Card title="Vigilante" subtitle="Detección por umbrales, sin modelo.">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {([
              { label: "Medios", value: alert.metrics.media_count },
              { label: "Notables", value: alert.metrics.notable_count },
              { label: "Negativas", value: alert.metrics.negative_count },
              { label: "Impresiones en X", value: alert.metrics.x_impressions },
            ]).map((item) => (
              <div key={item.label}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{item.label}</dt>
                <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                  {item.value == null || item.value === "" ? "—" : Number(item.value).toLocaleString("es-AR")}
                </dd>
              </div>
            ))}
          </dl>
          {Array.isArray(alert.metrics.outlets) && alert.metrics.outlets.length ? (
            <p className="mt-3 text-xs text-slate-500">Medios: {(alert.metrics.outlets as string[]).join(", ")}</p>
          ) : null}
        </Card>

        <Card title="Analista" subtitle="Qué pasó, quién lo empujó y qué alcance tuvo.">
          {analyst.diagnosis ? (
            <div className="space-y-3 text-sm leading-6 text-slate-700">
              <p>{analyst.diagnosis}</p>
              {analyst.who ? <p><span className="font-semibold text-slate-900">Quién. </span>{analyst.who}</p> : null}
              {analyst.reach ? <p><span className="font-semibold text-slate-900">Alcance. </span>{analyst.reach}</p> : null}
              {analyst.key_pieces?.length ? (
                <ul className="space-y-3">
                  {analyst.key_pieces.map((piece, i) => (
                    <li key={`${piece.url}-${i}`} className="rounded-lg border border-slate-100 p-3">
                      <p className="text-xs text-slate-500">
                        {piece.outlet_or_author}
                        {piece.published_at ? ` · ${piece.published_at}` : ""}
                      </p>
                      {piece.quote ? <p className="mt-1 italic">“{piece.quote}”</p> : null}
                      {piece.why ? <p className="mt-1 text-slate-600">{piece.why}</p> : null}
                      {piece.url ? (
                        <a href={piece.url} className="mt-1 inline-block break-all text-xs text-indigo-700 hover:underline" target="_blank" rel="noreferrer">
                          {piece.url}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">El Analista todavía no dejó un diagnóstico.</p>
          )}
        </Card>

        <Card title="Evidencia" subtitle="Expediente para denuncia manual, nunca automática.">
          {evidence.reason ? (
            <div className="space-y-2 text-sm leading-6 text-slate-700">
              <p>
                {evidence.dossier_recommended
                  ? "Recomienda armar un expediente para que una persona lo revise."
                  : "No recomienda un expediente de denuncia automática."}{" "}
                {evidence.reason}
              </p>
              {evidence.caveats ? <p className="text-slate-600">{evidence.caveats}</p> : null}
              {evidence.accounts?.length ? (
                <ul className="list-disc pl-5 text-sm">
                  {evidence.accounts.map((a) => (
                    <li key={a.handle}>
                      @{a.handle}: {a.why}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Evidencia no encontró una campaña coordinada que justifique un expediente.</p>
          )}
        </Card>

        <Card title="Estratega y Redactor" subtitle="Tres caminos, con borradores listos para copiar. Nada se envía solo.">
          {options.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay opciones de respuesta.</p>
          ) : (
            <div className="space-y-6">
              {options.map((option) => {
                const optionDrafts = drafts.filter((d) => d.option_id === option.id);
                return (
                  <section key={option.id} className="rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Opción {option.id}. {option.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{option.rationale}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Público: {option.audience}. Riesgo: {option.risk}. {option.when_to_use}
                    </p>
                    <div className="mt-3 grid gap-3">
                      {optionDrafts.map((draft) => (
                        <DraftBlock
                          key={`${option.id}-${draft.channel}`}
                          channel={draft.channel}
                          text={draft.text}
                          notes={draft.notes}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </Card>

        {brief ? (
          <p className="text-xs text-slate-400">
            Brief {brief.model} · {brief.prompt_version} · {formatDateTime(brief.created_at, clock)}.
            El costo queda registrado en la corrida; no se muestra acá.
          </p>
        ) : null}
      </div>
    </>
  );
}
