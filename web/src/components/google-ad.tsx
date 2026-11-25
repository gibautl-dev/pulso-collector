import { Badge } from "@/components/ui";
import {
  formatGoogleAdDate,
  formatGoogleSpend,
  formatImpressionRange,
  googleAdTypeLabel,
} from "@/lib/google-ads";
import type { GoogleAd } from "@/lib/types";

export function GoogleAdCard({ ad }: { ad: GoogleAd }) {
  const name = (ad.advertiser_name ?? "").trim() || "Anunciante sin nombre";
  const start = formatGoogleAdDate(ad.date_range_start ?? ad.first_served_at);
  const stop = formatGoogleAdDate(ad.date_range_end ?? ad.last_served_at);
  const geo = (ad.geo_targeting_included ?? "").split(",").slice(0, 4).map((s) => s.trim()).filter(Boolean);

  return (
    <li className="border-t border-slate-100 py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{name}</p>
            <Badge className="bg-white text-slate-600 ring-slate-200">{googleAdTypeLabel(ad.ad_type)}</Badge>
            {ad.regions.map((region) => (
              <Badge key={region} className="bg-slate-100 text-slate-600 ring-slate-200">
                {region}
              </Badge>
            ))}
          </div>
          {ad.ad_funded_by ? (
            <p className="mt-0.5 text-xs text-slate-500">Pagado por {ad.ad_funded_by}</p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            {start} – {stop}
            <span className="mx-1.5 text-slate-300">·</span>
            {formatImpressionRange(ad)}
            {ad.spend_currency ? (
              <>
                <span className="mx-1.5 text-slate-300">·</span>
                {formatGoogleSpend(ad)}
              </>
            ) : null}
          </p>
          {geo.length ? (
            <p className="mt-1 text-xs text-slate-500">
              Segmentación geográfica (recorte): {geo.join(", ")}
              {(ad.geo_targeting_included ?? "").split(",").length > 4 ? "…" : ""}
            </p>
          ) : null}
        </div>
        {ad.ad_url ? (
          <a
            href={ad.ad_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Ver en Google
          </a>
        ) : null}
      </div>
    </li>
  );
}
