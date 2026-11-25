import Link from "next/link";
import { CrisisTeamCard } from "@/components/crisis-team";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { loadCandidate } from "@/lib/context";
import {
  CRISIS_RISK_BADGE,
  CRISIS_RISK_LABEL,
  CRISIS_STATUS_BADGE,
  CRISIS_STATUS_LABEL,
  CRISIS_TRIGGER_LABEL,
  ACCION_SECTION_LABEL,
} from "@/lib/labels";
import { clockFor, formatDateTime } from "@/lib/time";

export const metadata = { title: `${ACCION_SECTION_LABEL} · Pulso` };

function metricNum(metrics: Record<string, unknown>, key: string): number | null {
  const raw = metrics[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

export default async function AccionPage({ params }: PageProps<"/c/[slug]/accion">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const { repo, candidate } = await loadCandidate(slug);
  const alerts = await repo.listCrisisAlerts(candidate.id);
  const open = alerts.filter((a) => a.status === "new" || a.status === "in_review");

  return (
    <>
      <PageHeader
        title={ACCION_SECTION_LABEL}
        description="Bandeja de alertas del equipo de agentes. Una persona aprueba o descarta; Pulso no publica ni postea nada."
      />
      <div className="space-y-6">
        <CrisisTeamCard />
        <Card
          title="Bandeja de alertas"
          subtitle={
            open.length
              ? `${open.length} pendiente${open.length === 1 ? "" : "s"} de una decisión humana`
              : "No hay alertas pendientes"
          }
        >
          {alerts.length === 0 ? (
            <EmptyState>
              Todavía no hay alertas para {candidate.name}. El Vigilante corre con el cron cuando el agente está
              prendido para este candidato.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.map((alert) => {
                const media = metricNum(alert.metrics, "media_count");
                const impressions = metricNum(alert.metrics, "x_impressions");
                const title = alert.latest_brief?.title || alert.cluster_label || "Alerta";
                return (
                  <li key={alert.id}>
                    <Link
                      href={`/c/${slug}/accion/${alert.id}`}
                      className="flex flex-col gap-2 py-4 hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={CRISIS_STATUS_BADGE[alert.status] ?? ""}>
                            {CRISIS_STATUS_LABEL[alert.status] ?? alert.status}
                          </Badge>
                          <Badge className={CRISIS_RISK_BADGE[alert.severity] ?? ""}>
                            {CRISIS_RISK_LABEL[alert.severity] ?? alert.severity}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            {CRISIS_TRIGGER_LABEL[alert.trigger_type] ?? alert.trigger_type}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-900">{title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Detectada {formatDateTime(alert.first_detected_at, clock)} ({clock.tzLabel}).
                          {media != null ? ` ${media} medio${media === 1 ? "" : "s"}.` : ""}
                          {impressions != null ? ` ${impressions.toLocaleString("es-AR")} impresiones en X.` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-indigo-700">Ver brief →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

