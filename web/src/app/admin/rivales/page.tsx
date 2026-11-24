import { Card, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/context";
import { RIVAL_LEVELS } from "@/lib/types";
import { RIVAL_LEVEL_HINT, RIVAL_LEVEL_LABEL } from "@/lib/labels";
import { saveRivals } from "./actions";

export const metadata = { title: "Rivales · Panel Active · Pulso" };

export default async function AdminRivalsPage() {
  const { repo, candidates } = await requireStaff();
  const assignments = await Promise.all(
    candidates.map(async (c) => ({ candidate: c, rivals: await repo.listRivals(c.id) })),
  );

  return (
    <>
      <PageHeader
        title="Asignar rivales"
        description="Elegí, para cada candidato, qué otros candidatos de Pulso entran en su comparación y a qué nivel. El cliente solo ve la comparación de su candidato. Pulso no propone rivales: la elección la hace este panel."
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
      </div>

      {candidates.length < 2 ? (
        <p className="text-sm text-slate-500">Hace falta más de un candidato en Pulso para armar una comparación.</p>
      ) : (
        <div className="space-y-6">
          {assignments.map(({ candidate, rivals }) => {
            const current = new Map(rivals.map((r) => [r.rival_id, r.level]));
            const others = candidates.filter((c) => c.id !== candidate.id);
            return (
              <Card key={candidate.id} title={candidate.name} subtitle={`/${candidate.slug}`}>
                <form action={saveRivals} className="space-y-3">
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
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
