import { notFound } from "next/navigation";
import { AssistantConversation } from "@/components/assistant/panel";
import { loadAssistantPanel } from "@/components/assistant/server";
import { PageHeader } from "@/components/ui";
import { ASSISTANT_LABEL } from "@/lib/assistant/suggestions";
import { loadCandidate } from "@/lib/context";

export const metadata = { title: `${ASSISTANT_LABEL} · Pulso` };

export default async function AsistentePage({ params }: PageProps<"/c/[slug]/asistente">) {
  const { slug } = await params;
  const { repo, candidate } = await loadCandidate(slug);
  const panel = await loadAssistantPanel(repo, candidate);
  if (!panel) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={ASSISTANT_LABEL}
        description={`Hacé preguntas sobre la conversación pública de ${candidate.name}. Cada respuesta muestra los datos y las fuentes en las que se apoya.`}
      />
      <section className="mt-6 flex h-[calc(100vh-13rem)] min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <AssistantConversation {...panel} />
      </section>
    </div>
  );
}
