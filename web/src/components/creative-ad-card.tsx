import { Badge } from "@/components/ui";
import type { CreativeAdCard } from "@/lib/rival-ads";

const GRADIENTS = [
  "from-fuchsia-600 to-pink-500",
  "from-blue-600 to-sky-400",
  "from-orange-500 to-red-500",
  "from-violet-600 to-indigo-500",
  "from-emerald-600 to-teal-400",
  "from-rose-600 to-orange-400",
];

function initial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % GRADIENTS.length;
  return GRADIENTS[h]!;
}

const STANCE_BADGE: Record<string, string> = {
  a_favor: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  en_contra: "bg-rose-50 text-rose-700 ring-rose-600/20",
  neutral_otro: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function CreativeAdCardView({ card }: { card: CreativeAdCard }) {
  const inner = (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-white">
          {initial(card.advertiser)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{card.advertiser}</p>
          <p className="text-xs text-slate-500">{card.sponsoredLabel}</p>
        </div>
      </div>
      <div className={`mx-4 mt-3 flex h-36 items-end overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white ${gradientFor(card.id)}`}>
        {card.body ? (
          <p className="line-clamp-5 text-base font-semibold leading-snug">{card.body}</p>
        ) : (
          <p className="text-sm font-medium leading-relaxed text-white/90">{card.bodyMissingReason}</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 px-4">
        {card.active != null ? (
          <Badge className={card.active ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
            {card.active ? "Activo" : "Inactivo"}
          </Badge>
        ) : null}
        {card.stance && card.stanceLabel ? <Badge className={STANCE_BADGE[card.stance]}>{card.stanceLabel}</Badge> : null}
      </div>
      <p className="mt-auto px-4 pb-4 pt-2 text-xs text-slate-500">
        {[card.impressions, card.since].filter(Boolean).join(" · ")}
      </p>
    </article>
  );
  if (card.href) {
    return (
      <a href={card.href} target="_blank" rel="noopener noreferrer nofollow" className="block h-full hover:opacity-95">
        {inner}
      </a>
    );
  }
  return inner;
}
