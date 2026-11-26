import { Badge, Card, PageHeader } from "@/components/ui";
import { CreateCandidateForm } from "@/components/create-candidate-form";
import { PauseResumeButton } from "@/components/pause-resume-button";
import { requireStaff } from "@/lib/context";
import { COLLECTION_MODE_LABEL, COUNTRY_LABEL } from "@/lib/labels";
import { regionFor } from "@/lib/region";

export const metadata = { title: "Candidatos · Panel Active · Pulso" };

export default async function AdminCandidatesPage() {
  const { candidates } = await requireStaff();

  return (
    <>
      <PageHeader
        title="Candidatos"
        description="Pausá o reanudá la recolección de cada candidato, o da de alta uno nuevo. Pausar no oculta el tablero ni borra lo ya medido."
      />

      <div className="space-y-4">
        {candidates.map((candidate) => {
          const paused = candidate.collection_paused === true;
          const country = candidate.country ?? regionFor(candidate.slug).country;
          const mode = candidate.collection_mode ?? "full";
          return (
            <Card
              key={candidate.id}
              title={candidate.name}
              subtitle={`/${candidate.slug}${candidate.office ? ` · ${candidate.office}` : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        paused
                          ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                          : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                      }
                    >
                      {paused ? "Pausado" : "Activo"}
                    </Badge>
                    <span className="text-sm text-slate-600">{COUNTRY_LABEL[country as "AR" | "ES"] ?? country}</span>
                    <span className="text-sm text-slate-500">
                      {COLLECTION_MODE_LABEL[mode as "full" | "media_only"] ?? mode}
                    </span>
                  </div>
                  {candidate.party ? <p className="text-sm text-slate-600">{candidate.party}</p> : null}
                </div>
                <PauseResumeButton candidateId={candidate.id} name={candidate.name} paused={paused} />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-8">
        <Card
          title="Alta de candidato"
          subtitle="Crea el candidato, aplica el preset de fuentes del país y le da acceso al equipo de Active. En la IA queda apagada salvo que la actives."
        >
          <CreateCandidateForm candidates={candidates} />
        </Card>
      </div>
    </>
  );
}
