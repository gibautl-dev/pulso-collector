import { Badge } from "@/components/ui";
import { adSnippet, adStance, formatMetaAdDate, formatSpendRange, isAdActive, publicAdLibraryUrl, STANCE_LABEL } from "@/lib/meta-ads";
import type { MetaAd } from "@/lib/types";

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  audience_network: "Audience Network",
  threads: "Threads",
};

function platformLabel(value: string): string {
  return PLATFORM_LABEL[value.toLowerCase()] ?? value;
}


const STANCE_BADGE: Record<string, string> = {
  a_favor: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  en_contra: "bg-rose-50 text-rose-700 ring-rose-600/20",
  neutral_otro: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

function stanceBadge(ad: MetaAd) {
  const stance = adStance(ad);
  if (!stance) return null;
  return <Badge className={STANCE_BADGE[stance]}>{STANCE_LABEL[stance]}</Badge>;
}

export function MetaAdCard({ ad, now }: { ad: MetaAd; now: Date }) {
  const active = isAdActive(ad, now);
  const libraryUrl = publicAdLibraryUrl(ad.ad_id);
  const start = formatMetaAdDate(ad.ad_delivery_start_time ?? ad.ad_creation_time);
  const stop = ad.ad_delivery_stop_time ? formatMetaAdDate(ad.ad_delivery_stop_time) : "sigue activo";
  const page = (ad.page_name ?? "").trim() || "Página sin nombre";
  const snippet = adSnippet(ad);

  return (
    <li className="border-t border-slate-100 py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{page}</p>
            <Badge className={active ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
              {active ? "Activo" : "Inactivo"}
            </Badge>
            {ad.publisher_platforms.map((p) => (
              <Badge key={p} className="bg-white text-slate-600 ring-slate-200">
                {platformLabel(p)}
              </Badge>
            ))}
            {stanceBadge(ad)}
          </div>
          {ad.bylines && ad.bylines.trim() !== page ? (
            <p className="mt-0.5 text-xs text-slate-500">Pagado por {ad.bylines.trim()}</p>
          ) : null}
          <p className="mt-2 text-sm text-slate-700">{snippet}</p>
          {ad.stance_reason ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {STANCE_LABEL[adStance(ad)!] ?? "Clasificación"}: {ad.stance_reason}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            {start} – {stop}
            <span className="mx-1.5 text-slate-300">·</span>
            {formatSpendRange(ad.currency, ad.spend_lower as number | null, ad.spend_upper as number | null)}
          </p>
        </div>
        {libraryUrl ? (
          <a
            href={libraryUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Ver en la Biblioteca
          </a>
        ) : null}
      </div>
    </li>
  );
}
