import { Card } from "@/components/ui";

const AGENTS = [
  { name: "Vigilante", role: "Detecta picos, temas emergentes, campañas y anuncios en contra, con umbrales sobre datos reales. No usa el modelo." },
  { name: "Analista", role: "Explica qué pasó, quién lo empujó y qué alcance tuvo, con piezas citadas." },
  { name: "Evidencia", role: "Arma un expediente solo si hay indicios de campaña coordinada, para que una persona denuncie a mano. Nunca en automático." },
  { name: "Estratega", role: "Propone tres caminos de respuesta, con público, riesgo y cuándo usar cada uno." },
  { name: "Redactor", role: "Deja borradores listos por canal (X, comunicado, argumento oral) para cada camino." },
  { name: "Coordinador", role: "Junta el trabajo y te lo entrega. La última palabra es siempre de una persona." },
];

export const CRISIS_PITCH =
  "Pulso no te deja solo con un reporte: cuando salta una alerta, varios agentes de IA se coordinan para un solo objetivo, que tu equipo pueda actuar. El Vigilante detecta el problema, el Analista explica qué pasó, quién lo empujó y qué alcance tuvo, el Estratega propone tres caminos y el Redactor deja los borradores listos por canal. Si hay una campaña coordinada, Evidencia arma el expediente para denunciarla a mano, nunca en automático. El Coordinador junta todo y te lo entrega; la última palabra es siempre de una persona, y no usamos cuentas falsas ni respuestas en masa.";

export function CrisisTeamCard() {
  return (
    <Card title="El equipo de agentes" subtitle="Se coordinan para que puedas actuar. Nada se publica solo.">
      <p className="text-sm leading-6 text-slate-600">{CRISIS_PITCH}</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {AGENTS.map((agent) => (
          <li key={agent.name} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
            <p className="text-sm font-semibold text-slate-900">{agent.name}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{agent.role}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
