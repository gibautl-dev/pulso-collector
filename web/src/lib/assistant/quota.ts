/** Cupos del asistente (mensajes para el cliente, sin jerga). Sin I/O. */
import type { AssistantQuota } from "@/lib/types";
import { LIMITS } from "./prompt";

export const ASSISTANT_UNAVAILABLE = "El asistente todavía no está disponible para esta cuenta.";
export const ASSISTANT_ERROR = "No pude responder en este momento. Probá de nuevo en unos minutos.";

export function quotaBlock(q: AssistantQuota, caps: { perQuestion: number; perDay: number }): string | null {
  if (q.user_last_hour >= LIMITS.perUserPerHour) return "Hiciste muchas preguntas seguidas. Probá de nuevo en un rato.";
  if (q.user_today >= LIMITS.perUserPerDay) return "Llegaste al máximo de preguntas de hoy. Mañana podés seguir.";
  if (q.total_today >= LIMITS.perDayTotal || q.cost_today_usd + caps.perQuestion > caps.perDay) {
    return "El asistente llegó a su límite de hoy. Vuelve a estar disponible mañana.";
  }
  return null;
}
