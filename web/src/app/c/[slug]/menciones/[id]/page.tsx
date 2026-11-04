import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, RelevanceBadge, ToneBadge } from "@/components/ui";
import { cleanTitle } from "@/components/mention-row";
import { loadCandidate } from "@/lib/context";
import { sourceLabel, TARGET_LABEL } from "@/lib/labels";
import { formatDateTime, TZ_LABEL } from "@/lib/time";

export const metadata = { title: "Detalle de mención · Pulso" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Google News repite título + medio como "contenido": no lo mostramos dos veces. */
function showContent(content: string | null, title: string | null): boolean {
  const c = (content ?? "").trim();
  const t = (title ?? "").trim();
  if (!c) return false;
  const head = t.replace(/ - [^-]+$/, "");
  return !(c === t || c.startsWith(head)) || c.length > t.length + 60;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2 text-slate-900">{children}</dd>
    </div>
  );
}

export default async function MentionDetail({ params }: PageProps<"/c/[slug]/menciones/[id]">) {
  const { slug, id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { repo, candidate } = await loadCandidate(slug);
  const [m, topics] = await Promise.all([repo.getMention(candidate.id, id), repo.listTopics(candidate.id)]);
  if (!m) notFound();
  const topic = m.topic_id ? topics.find((t) => t.id === m.topic_id)?.label : undefined;
  const conf = m.tone_confidence === null ? null : Math.round(Number(m.tone_confidence) * 100);
  const isManual = m.classification_model?.startsWith("manual") || m.classification_prompt_version?.startsWith("manual");

  return (
    <>
      <Link href={`/c/${slug}/menciones`} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">← Volver a menciones</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={m.tone} />
              <RelevanceBadge relevance={m.relevance} />
              {m.target && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{TARGET_LABEL[m.target]}</span>}
            </div>
            <h1 className="mt-3 text-xl font-semibold leading-snug text-slate-900">{cleanTitle(m)}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {m.outlet ?? "Sin medio"} · {formatDateTime(m.published_at)} ({TZ_LABEL})
            </p>
            {showContent(m.content, m.title) && (
              <blockquote className="mt-4 border-l-2 border-slate-200 pl-4 text-sm leading-relaxed text-slate-700">{m.content}</blockquote>
            )}
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Abrir nota original
            </a>
          </Card>

          <Card title="Por qué se clasificó así" subtitle={isManual ? "Clasificación manual inicial." : "Explicación del modelo de IA."}>
            {m.tone ? (
              <>
                <p className="text-sm leading-relaxed text-slate-800">{m.tone_reason ?? "Sin explicación guardada."}</p>
                {conf !== null && (
                  <div className="mt-5">
                    <div className="mb-1 flex justify-between text-xs text-slate-600">
                      <span>Confianza del clasificador</span>
                      <span className="font-semibold tabular-nums text-slate-900">{conf}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div
                        className={`h-2 rounded-full ${conf >= 80 ? "bg-emerald-500" : conf >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${conf}%` }}
                      />
                    </div>
                    {conf < 60 && <p className="mt-2 text-xs text-amber-700">Confianza baja: conviene revisarla a mano.</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">Todavía no se clasificó. El clasificador corre cada 20 minutos.</p>
            )}
          </Card>
        </div>

        <Card title="Datos">
          <dl className="divide-y divide-slate-100">
            <Row label="Candidato">{candidate.name}</Row>
            <Row label="Sobre quién">{m.target ? TARGET_LABEL[m.target] : "—"}</Row>
            <Row label="Tema">{topic ?? "—"}</Row>
            <Row label="Fuente">{sourceLabel(m.source)}</Row>
            <Row label="Medio">{m.outlet ?? "—"}</Row>
            {m.author && <Row label="Autor">{m.author}</Row>}
            <Row label="Publicada">{formatDateTime(m.published_at)}</Row>
            <Row label="Recolectada">{formatDateTime(m.collected_at)}</Row>
            <Row label="Clasificada">{formatDateTime(m.classified_at)}</Row>
            <Row label="Modelo">{m.classification_model ?? "—"}</Row>
            <Row label="Versión de prompt">
              <span className="break-all font-mono text-xs">{m.classification_prompt_version ?? "—"}</span>
            </Row>
          </dl>
        </Card>
      </div>
    </>
  );
}
