import { Card, PageHeader } from "@/components/ui";
import { SimulatorForm } from "@/components/response-simulator-form";
import { HistoryList, RiskHero, SegmentCard, SuggestedVersion, TopicChips } from "@/components/response-simulator";
import { loadCandidate } from "@/lib/context";
import { SIMULATOR_SECTION_LABEL, normalizeStoredContext, normalizeStoredOutput } from "@/lib/response-simulator";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: `${SIMULATOR_SECTION_LABEL} · Pulso` };

export default async function SimuladorPage({ params, searchParams }: PageProps<"/c/[slug]/simulador">) {
  const { slug } = await params;
  const sp = await searchParams;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const history = await repo.listResponseSimulations(candidate.id, 8);
  const wanted = typeof sp.sim === "string" ? sp.sim : null;
  const sim = wanted ? (history.find((h) => h.id === wanted) ?? (await repo.getResponseSimulation(candidate.id, wanted))) : null;
  const output = sim && sim.status === "ok" ? normalizeStoredOutput(sim.output) : null;
  const ctx = sim ? normalizeStoredContext(sim.context) : null;
  const mentionsByRef = new Map((ctx?.mentions ?? []).map((m) => [m.ref, m]));
  const segByKey = new Map((ctx?.segments ?? []).map((s) => [s.key, s]));
  const rivalName = ctx?.rival?.name ?? null;

  return (
    <>
      <PageHeader
        title={SIMULATOR_SECTION_LABEL}
        description={`Probá un borrador de ${candidate.name} antes de usarlo: cómo caería en cada público y frente al rival.`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" testId="simulador-borrador">
          <SimulatorForm key={sim?.id ?? "nuevo"} slug={slug} initialDraft={sim?.draft ?? ""} candidateName={candidate.name} />
        </Card>
        <Card title="Mis simulaciones" subtitle="Solo las ves vos." testId="simulador-historial">
          <HistoryList
            slug={slug}
            activeId={sim?.id ?? null}
            formatTime={(iso) => `${formatDateTime(iso, clock)} ${clock.tzLabel}`}
            items={history.map((h) => ({
              id: h.id,
              draft: h.draft,
              created_at: h.created_at,
              status: h.status,
              risk: h.status === "ok" ? normalizeStoredOutput(h.output) : null,
            }))}
          />
        </Card>
      </div>

      {sim && sim.status === "error" ? (
        <Card className="mt-6">
          <p className="text-sm text-slate-600">Esta simulación no tuvo resultado. Probá de nuevo o reformulá el borrador.</p>
        </Card>
      ) : null}

      {output && ctx ? (
        <div className="mt-6 space-y-4" data-testid="simulador-resultado">
          <TopicChips topics={ctx.matched_topics} detected={ctx.topic_detected} />
          <RiskHero output={output} windowDays={ctx.window_days} rivalName={rivalName} />
          <div className="grid gap-4 lg:grid-cols-2">
            {output.segments.map((s) => (
              <SegmentCard key={s.key} result={s} segment={segByKey.get(s.key)} mentions={mentionsByRef} rivalName={rivalName} />
            ))}
          </div>
          <SuggestedVersion text={output.suggested_version} />
        </div>
      ) : null}
    </>
  );
}
