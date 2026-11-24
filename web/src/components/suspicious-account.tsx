import { Badge, SourceBadge } from "@/components/ui";
import { updateSuspiciousStatus } from "@/app/c/[slug]/sospechosas/actions";
import {
  SUSPICIOUS_STATUS_BADGE,
  SUSPICIOUS_STATUS_LABEL,
  suspiciousAccountLabel,
  suspiciousSignalLabel,
} from "@/lib/labels";
import { clockFor, formatDateTime } from "@/lib/time";
import type { SuspiciousAccount, SuspiciousStatus } from "@/lib/types";

const ACTIONS: { status: SuspiciousStatus; label: string }[] = [
  { status: "pending", label: "Pendiente" },
  { status: "reviewed_suspicious", label: "Sospechosa" },
  { status: "discarded", label: "Descartada" },
  { status: "reported_manual", label: "Denunciada a mano" },
];

export function SuspiciousAccountCard({ account, slug }: { account: SuspiciousAccount; slug: string }) {
  const clock = clockFor(slug);
  const label = suspiciousAccountLabel(account);
  const created = account.account_created_at
    ? `Creada el ${formatDateTime(account.account_created_at, clock)} (${clock.tzLabel})`
    : account.platform === "youtube"
      ? "Sin fecha de creación del canal"
      : "Sin fecha de creación";

  return (
    <li className="border-b border-slate-100 py-5 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-slate-900">{label}</p>
            <SourceBadge source={account.platform} />
            <Badge className={SUSPICIOUS_STATUS_BADGE[account.status]}>{SUSPICIOUS_STATUS_LABEL[account.status]}</Badge>
          </div>
          {account.display_name && account.display_name !== label && (
            <p className="mt-0.5 text-sm text-slate-600">{account.display_name}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {account.mention_count} {account.mention_count === 1 ? "mención" : "menciones"}
            {account.first_seen_at ? ` · primera ${formatDateTime(account.first_seen_at, clock)}` : ""}
            {account.last_seen_at ? ` · última ${formatDateTime(account.last_seen_at, clock)}` : ""}
            {` · ${created}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Puntaje</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{account.score}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {account.signals.map((sig) => (
          <Badge key={`${sig.type}-${sig.weight}`} className="bg-slate-50 text-slate-700 ring-slate-300">
            {suspiciousSignalLabel(sig.type)} · {sig.weight}
          </Badge>
        ))}
      </div>

      {account.profile_url && (
        <p className="mt-3 text-sm">
          <a
            href={account.profile_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            Ver perfil y denunciar a mano
          </a>
          <span className="text-slate-500"> — Pulso no denuncia; el link abre la red para hacerlo vos.</span>
        </p>
      )}

      <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Evidencia y motivos</summary>
        <ul className="mt-3 space-y-4">
          {account.signals.map((sig, i) => (
            <li key={`${sig.type}-${i}`}>
              <p className="text-sm font-medium text-slate-900">
                {suspiciousSignalLabel(sig.type)} ({sig.weight}): {sig.summary}
              </p>
              <ul className="mt-2 space-y-2">
                {sig.evidence.map((ev) => (
                  <li key={ev.mention_id} className="text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{formatDateTime(ev.published_at, clock)} ({clock.tzLabel}) · </span>
                    {ev.url ? (
                      <a href={ev.url} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-600 hover:text-indigo-500">
                        {ev.excerpt || "Ver mención"}
                      </a>
                    ) : (
                      ev.excerpt || ev.mention_id
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>

      <form action={updateSuspiciousStatus} className="mt-4 rounded-lg border border-slate-200 p-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={account.id} />
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Nota opcional</span>
          <input
            type="text"
            name="status_note"
            defaultValue={account.status_note ?? ""}
            maxLength={500}
            placeholder="Por qué la marcás así"
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action.status}
              type="submit"
              name="status"
              value={action.status}
              disabled={account.status === action.status}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm ${
                account.status === action.status
                  ? "cursor-default bg-slate-200 text-slate-500"
                  : "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
        {account.status_updated_at && (
          <p className="mt-2 text-xs text-slate-500">
            Estado actualizado el {formatDateTime(account.status_updated_at, clock)} ({clock.tzLabel})
          </p>
        )}
      </form>
    </li>
  );
}
