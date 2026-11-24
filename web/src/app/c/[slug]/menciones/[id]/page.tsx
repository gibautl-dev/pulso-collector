import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, RelevanceBadge, SourceBadge, ToneBadge } from "@/components/ui";
import { cleanTitle } from "@/components/mention-row";
import { loadCandidate } from "@/lib/context";
import { sourceLabel, TARGET_LABEL } from "@/lib/labels";
import { clockFor, formatDateTime } from "@/lib/time";
import {
  formatCount,
  isYoutubeComment,
  youtubeStats,
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from "@/lib/youtube";

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
  const clock = clockFor(slug);
  if (!UUID_RE.test(id)) notFound();
  const { repo, candidate } = await loadCandidate(slug);
  const [m, topics] = await Promise.all([repo.getMention(candidate.id, id), repo.listTopics(candidate.id)]);
  if (!m) notFound();
  const topic = m.topic_id ? topics.find((t) => t.id === m.topic_id)?.label : undefined;
  const conf = m.tone_confidence === null ? null : Math.round(Number(m.tone_confidence) * 100);
  const isManual = m.classification_model?.startsWith("manual") || m.classification_prompt_version?.startsWith("manual");
  const isYt = m.source === "youtube";
  const ytComment = isYt && isYoutubeComment(m);
  const videoId = isYt ? youtubeVideoId(m) : null;
  const thumb = videoId ? youtubeThumbnailUrl(videoId) : null;
  const stats = isYt ? youtubeStats(m) : null;
  const videoUrl = videoId ? youtubeWatchUrl(videoId) : m.url;

  return (
    <>
      <Link href={`/c/${slug}/menciones`} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">← Volver a menciones</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={m.tone} />
              <RelevanceBadge relevance={m.relevance} />
              <SourceBadge source={m.source} />
              {isYt && (
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ytComment ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-800"}`}>
                  {ytComment ? "Comentario" : "Video"}
                </span>
              )}
              {m.target && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{TARGET_LABEL[m.target]}</span>}
            </div>
            {isYt && thumb && (
              <a href={videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-4 block overflow-hidden rounded-lg bg-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb} alt="" width={640} height={360} className="aspect-video w-full max-w-xl object-cover" />
              </a>
            )}
            <h1 className="mt-3 text-xl font-semibold leading-snug text-slate-900">{cleanTitle(m)}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {isYt
                ? [ytComment ? m.author : null, m.outlet ?? m.author ?? "YouTube"].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ")
                : (m.outlet ?? "Sin medio")} · {formatDateTime(m.published_at, clock)} ({clock.tzLabel})
            </p>
            {isYt && stats && (
              <dl className="mt-4 grid grid-cols-3 gap-3 max-w-md">
                {!ytComment && (
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-500">Vistas</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-900">{stats.views != null ? formatCount(stats.views) : "—"}</dd>
                  </div>
                )}
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">Me gusta</dt>
                  <dd className="text-sm font-semibold tabular-nums text-slate-900">{stats.likes != null ? formatCount(stats.likes) : "—"}</dd>
                </div>
                {!ytComment && (
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-500">Comentarios</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-900">{stats.comments != null ? formatCount(stats.comments) : "—"}</dd>
                  </div>
                )}
                {ytComment && stats.replies != null && (
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-500">Respuestas</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-900">{formatCount(stats.replies)}</dd>
                  </div>
                )}
              </dl>
            )}
            {showContent(m.content, m.title) && (
              <blockquote className="mt-4 border-l-2 border-slate-200 pl-4 text-sm leading-relaxed text-slate-700">{m.content}</blockquote>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                {isYt ? (ytComment ? "Ver comentario en YouTube" : "Ver en YouTube") : "Abrir nota original"}
              </a>
              {isYt && ytComment && videoId && (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Ver video
                </a>
              )}
            </div>
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
            {isYt && <Row label="Tipo">{ytComment ? "Comentario" : "Video"}</Row>}
            {isYt ? (
              <>
                <Row label="Canal">{m.outlet ?? m.author ?? "—"}</Row>
                {ytComment && m.author && <Row label="Autor">{m.author}</Row>}
              </>
            ) : (
              <>
                <Row label="Medio">{m.outlet ?? "—"}</Row>
                {m.author && <Row label="Autor">{m.author}</Row>}
              </>
            )}
            <Row label="Publicada">{formatDateTime(m.published_at, clock)}</Row>
            <Row label="Recolectada">{formatDateTime(m.collected_at, clock)}</Row>
            <Row label="Clasificada">{formatDateTime(m.classified_at, clock)}</Row>
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
