import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { MentionRow } from "@/components/mention-row";
import { loadCandidate } from "@/lib/context";
import { filtersToSearch, hasActiveFilters, PAGE_SIZE, parseFilters } from "@/lib/filters";
import { RELEVANCE, RELEVANCE_LABEL, sourceLabel, TARGET_LABEL, TONES, TONE_LABEL } from "@/lib/labels";

export const metadata = { title: "Menciones · Pulso" };

const selectCls =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export default async function MentionsPage({ params, searchParams }: PageProps<"/c/[slug]/menciones">) {
  const { slug } = await params;
  const f = parseFilters(await searchParams);
  const { repo, candidate } = await loadCandidate(slug);
  const [topics, sources, page] = await Promise.all([
    repo.listTopics(candidate.id),
    repo.listCandidateSources(candidate.id),
    repo.searchMentions(candidate.id, f, PAGE_SIZE),
  ]);
  const topicLabel = new Map(topics.map((t) => [t.id, t.label]));
  const sourceOptions = sources.filter((s) => s.enabled).map((s) => s.source);
  const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  const base = `/c/${slug}/menciones`;

  return (
    <>
      <PageHeader title="Menciones" description={`${page.total} resultados${hasActiveFilters(f) ? " con los filtros aplicados" : ""}`} />

      <Card className="mb-6">
        <form method="get" action={base} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="col-span-2 md:col-span-3 xl:col-span-2">
            <Field label="Buscar">
              <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Palabra en título o texto" className={selectCls} maxLength={80} />
            </Field>
          </div>
          <Field label="Tono">
            <select name="tone" defaultValue={f.tone ?? ""} className={selectCls}>
              <option value="">Todos</option>
              <option value="negativas">Críticas + acusaciones + insultos</option>
              {TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
              <option value="pendiente">Sin clasificar</option>
            </select>
          </Field>
          <Field label="Sobre quién">
            <select name="target" defaultValue={f.target ?? ""} className={selectCls}>
              <option value="">Todos</option>
              {(["candidate", "other", "unclear"] as const).map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Tema">
            <select name="topic" defaultValue={f.topic ?? ""} className={selectCls}>
              <option value="">Todos</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Fuente">
            <select name="source" defaultValue={f.source ?? ""} className={selectCls}>
              <option value="">Todas</option>
              {sourceOptions.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
            </select>
          </Field>
          <Field label="Relevancia">
            <select name="relevance" defaultValue={f.relevance ?? ""} className={selectCls}>
              <option value="">Todas</option>
              {RELEVANCE.map((r) => <option key={r} value={r}>{RELEVANCE_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field label="Desde">
            <input type="date" name="from" defaultValue={f.from ?? ""} className={selectCls} />
          </Field>
          <Field label="Hasta">
            <input type="date" name="to" defaultValue={f.to ?? ""} className={selectCls} />
          </Field>
          <div className="col-span-2 flex items-end gap-3 md:col-span-1 xl:col-span-2">
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              Filtrar
            </button>
            {hasActiveFilters(f) && (
              <Link href={base} className="text-sm font-medium text-slate-600 hover:text-slate-900">Limpiar filtros</Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
        {page.items.length === 0 ? (
          <EmptyState>No hay menciones que coincidan con los filtros.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {page.items.map((m) => (
              <MentionRow key={m.id} m={m} slug={slug} topicLabel={m.topic_id ? topicLabel.get(m.topic_id) : undefined} />
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-sm" aria-label="Paginación">
            {f.page > 1 ? (
              <Link href={`${base}${filtersToSearch(f, { page: f.page - 1 })}`} className="font-medium text-indigo-600">← Anteriores</Link>
            ) : <span />}
            <span className="text-slate-500">Página {f.page} de {pages}</span>
            {f.page < pages ? (
              <Link href={`${base}${filtersToSearch(f, { page: f.page + 1 })}`} className="font-medium text-indigo-600">Siguientes →</Link>
            ) : <span />}
          </nav>
        )}
      </Card>
    </>
  );
}
