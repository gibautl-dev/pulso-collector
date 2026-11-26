import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/context";
import { CUSTOM_TOPICS_SECTION_LABEL } from "@/lib/labels";
import { regionFor } from "@/lib/region";
import { saveCustomTopicAction } from "./actions";

export const metadata = { title: `${CUSTOM_TOPICS_SECTION_LABEL} · Panel Active · Pulso` };

export default async function AdminTemasPage() {
  const { repo, candidates } = await requireStaff();
  const topics = await Promise.all(
    candidates.map(async (c) => ({ candidate: c, topics: await repo.listCustomTopics(c.id) })),
  );

  return (
    <>
      <PageHeader
        title={`Definir ${CUSTOM_TOPICS_SECTION_LABEL.toLowerCase()}`}
        description="Por cada candidato podés cargar temáticas a seguir, con palabras clave e exclusiones. Pulso las cruza con menciones que ya recolecta. El cliente ve la sección y el analista; no se agregan fuentes nuevas ni se publica nada solo."
      />
      <p className="mb-6 text-xs text-slate-500">
        Hoy solo el equipo de Active puede crear o editar. Más adelante un admin del candidato podría hacerlo, si se
        le asigna ese rol a mano: esta rama no invita usuarios ni cambia roles existentes.
      </p>
      <div className="space-y-6">
        {topics.map(({ candidate, topics: list }) => {
          const region = regionFor(candidate.slug, candidate.country);
          return (
            <div key={candidate.id} id={`temas-${candidate.slug}`}>
              <Card title={candidate.name} subtitle={`/${candidate.slug} · ${region.countryName}`}>
                {list.length ? (
                  <ul className="mb-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                    {list.map((topic) => (
                      <li key={topic.id} className="px-3 py-2 text-sm">
                        <p className="font-medium text-slate-900">
                          {topic.name}{" "}
                          <span className="text-xs font-normal text-slate-500">{topic.enabled ? "activo" : "pausado"}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {[...topic.keywords, ...topic.include_terms].join(", ")}
                          {topic.exclude_terms.length ? ` · excluye ${topic.exclude_terms.join(", ")}` : ""}
                        </p>
                        <p className="mt-1">
                          <Link href={`/c/${candidate.slug}/temas/${topic.id}`} className="text-xs font-medium text-indigo-700 hover:underline">
                            Ver en el tablero del candidato
                          </Link>
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-4 text-sm text-slate-500">Todavía no hay temas a medida para este candidato.</p>
                )}
                <form action={saveCustomTopicAction} className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <input type="hidden" name="candidate_id" value={candidate.id} />
                  <p className="text-sm font-medium text-slate-800">Sumar un tema</p>
                  <label className="block text-xs text-slate-500">
                    Nombre
                    <input
                      name="name"
                      required
                      maxLength={80}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Descripción (opcional)
                    <textarea
                      name="description"
                      rows={2}
                      maxLength={400}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Palabras clave (separadas por coma)
                    <input
                      name="keywords"
                      required
                      placeholder="salud, hospital"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    También incluir (opcional)
                    <input
                      name="include_terms"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Excluir (opcional)
                    <input
                      name="exclude_terms"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Fuentes (opcional: rss_media, google_news, x). Vacío = todas las que ya se recolectan.
                    <input
                      name="sources"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="enabled" value="on" defaultChecked className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                    Activo
                  </label>
                  <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                    Guardar tema para {candidate.name}
                  </button>
                </form>
              </Card>
            </div>
          );
        })}
      </div>
    </>
  );
}
