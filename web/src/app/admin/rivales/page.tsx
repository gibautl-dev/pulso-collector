import { Card, PageHeader } from "@/components/ui";
import { PendingAltaForm } from "@/components/pending-alta-form";
import { PendingRowActions } from "@/components/pending-row-actions";
import { SuggestRivalsForm } from "@/components/suggest-rivals-form";
import { requireStaff } from "@/lib/context";
import { PENDING_CANDIDATE_STATUS_LABEL, RIVAL_LEVEL_HINT, RIVAL_LEVEL_LABEL } from "@/lib/labels";
import { regionFor } from "@/lib/region";
import { buildOnboardingCostTable, COST_TABLE_FOOTNOTE, RIVAL_SUGGEST_MAX_COST_USD } from "@/lib/rival-suggest";
import { RIVAL_LEVELS } from "@/lib/types";
import { saveRivals } from "./actions";

export const metadata = { title: "Rivales · Panel Active · Pulso" };

export default async function AdminRivalsPage() {
  const { repo, candidates } = await requireStaff();
  const assignments = await Promise.all(
    candidates.map(async (c) => ({
      candidate: c,
      rivals: await repo.listRivals(c.id),
      suggestions: await repo.latestSuggestionRun(c.id),
      pending: await repo.listPendingCandidates(c.id),
      costTable: buildOnboardingCostTable(regionFor(c.slug)),
    })),
  );

  return (
    <>
      <PageHeader
        title="Asignar rivales"
        description="Para cada candidato podés elegir rivales que Pulso ya mide, pedir sugerencias de IA para revisar, o anotar un nombre que todavía no se recolecta. Nada se suma solo: una persona confirma. Un pendiente de alta no se mide hasta que Active lo apruebe."
      />

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Niveles</p>
        <ul className="mt-2 space-y-1">
          {RIVAL_LEVELS.map((level) => (
            <li key={level}>
              <span className="font-medium text-slate-900">{RIVAL_LEVEL_LABEL[level]}.</span> {RIVAL_LEVEL_HINT[level]}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          El costo de un alta nueva se muestra en una tabla por nivel, con dato real, EST o CALC, o “sin dato” si no hay cifra. Cada clic de sugerencia de IA tiene un tope de USD {RIVAL_SUGGEST_MAX_COST_USD.toFixed(2)} y no usa búsqueda web.
        </p>
      </div>

      <div className="space-y-6">
        {assignments.map(({ candidate, rivals, suggestions, pending, costTable }) => {
          const current = new Map(rivals.map((r) => [r.rival_id, r.level]));
          const others = candidates.filter((c) => c.id !== candidate.id);
          const region = regionFor(candidate.slug);
          return (
            <div key={candidate.id} id={`rivales-${candidate.slug}`}>
            <Card title={candidate.name} subtitle={`/${candidate.slug} · ${region.countryName}`}>
              <div className="space-y-6">
                <section>
                  <h3 className="text-sm font-semibold text-slate-900">Ya medidos en Pulso</h3>
                  {others.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Todavía no hay otro candidato medido para comparar. Podés pedir un alta nueva abajo.</p>
                  ) : (
                    <form action={saveRivals} className="mt-2 space-y-3">
                      <input type="hidden" name="candidate_id" value={candidate.id} />
                      <ul className="divide-y divide-slate-100">
                        {others.map((other) => {
                          const level = current.get(other.id);
                          return (
                            <li key={other.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                                <input
                                  type="checkbox"
                                  name="rival_id"
                                  value={other.id}
                                  defaultChecked={Boolean(level)}
                                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                                />
                                {other.name}
                                <span className="text-xs font-normal text-slate-500">{regionFor(other.slug).countryName}</span>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-slate-500">
                                Nivel
                                <select
                                  name={`level_${other.id}`}
                                  defaultValue={level ?? "comparativo"}
                                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                                >
                                  {RIVAL_LEVELS.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {RIVAL_LEVEL_LABEL[opt]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <button
                        type="submit"
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        Guardar para {candidate.name}
                      </button>
                    </form>
                  )}
                </section>

                <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Sugerir rivales con IA</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Propone 5 a 8 nombres en la misma arena, para que los revises. No se agregan solos.
                      </p>
                    </div>
                    <SuggestRivalsForm candidateId={candidate.id} hasSuggestions={Boolean(suggestions)} />
                  </div>
                  {suggestions ? (
                    <div className="mt-3">
                      <p className="rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                        {suggestions.origin === "fixture_example"
                          ? "Ejemplo de interfaz (modo local). Estas filas no salen de una corrida real del modelo."
                          : `Sugerencias de IA para verificar. Modelo ${suggestions.model ?? "s/d"}. Costo de esta corrida: ${
                              suggestions.cost_usd == null
                                ? "desconocido"
                                : `USD ${suggestions.cost_usd < 0.01 ? suggestions.cost_usd.toFixed(6) : suggestions.cost_usd.toFixed(2)}`
                            }.`}
                        {suggestions.note ? ` ${suggestions.note}` : ""}
                      </p>
                      <ul className="mt-2 space-y-3">
                        {suggestions.suggestions.map((item) => (
                          <li key={item.name} className="rounded-md border border-slate-200 bg-white p-3">
                            <p className="text-sm font-medium text-slate-900">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.arena}</p>
                            <p className="mt-1 text-sm text-slate-700">{item.reason}</p>
                            {item.already_in_pulso ? (
                              <p className="mt-2 text-xs text-emerald-800">
                                Ya está en Pulso{item.matched_candidate_slug ? ` (/${item.matched_candidate_slug})` : ""}. Si lo querés en la comparación, marcá la casilla de arriba y guardá. No se suma solo.
                              </p>
                            ) : (
                              <PendingAltaForm
                                compact
                                candidateId={candidate.id}
                                source="ai_suggestion"
                                defaultName={item.name}
                                defaultArena={item.arena}
                                defaultReason={item.reason}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">Todavía no hay una sugerencia guardada para este candidato.</p>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-slate-900">Sumar un rival que Pulso todavía no mide</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Queda como {PENDING_CANDIDATE_STATUS_LABEL.toLowerCase()}. No se recolecta ni entra al tablero del cliente hasta que Active lo apruebe. Aprobar lo deja listo para recolectar, pero todavía no enciende la recolección.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-1.5 pr-4 font-medium">Nivel</th>
                          <th className="py-1.5 pr-4 font-medium">USD/mes</th>
                          <th className="py-1.5 font-medium">Nota</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {costTable.map((row) => (
                          <tr key={row.level}>
                            <td className="whitespace-nowrap py-2 pr-4 font-medium text-slate-900">{RIVAL_LEVEL_LABEL[row.level]}</td>
                            <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-slate-800">{row.amount}</td>
                            <td className="py-2 text-xs text-slate-600">{row.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{COST_TABLE_FOOTNOTE}</p>
                  {pending.length ? (
                    <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
                      {pending.map((row) => (
                        <PendingRowActions key={row.id} row={row} />
                      ))}
                    </ul>
                  ) : null}
                  <PendingAltaForm candidateId={candidate.id} source="manual" arenaPlaceholder={region.countryName} />

                </section>
              </div>
            </Card>
            </div>
          );
        })}
      </div>
    </>
  );
}
