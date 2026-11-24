import { computeAiDashboard, formatBalance as formatAiBalance, formatShare } from "./ai-visibility";
import { aggregateSpend, formatSpendAggregate, stanceSplit, type SpendByCurrency } from "./meta-ads";
import { computeSuspiciousInsights, formatPercent } from "./suspicious-insights";
import type { AiAnswer, Mention, MetaAd, SuspiciousAccount, Topic } from "./types";
import { computeXView, formatBalance as formatXBalance } from "./x-posts";
import { META_ADS_EU_UNAVAILABLE } from "./region";

export interface HomeCardStat {
  label: string;
  value: string;
}

export interface HomeSourceCard {
  href: string;
  title: string;
  hint: string;
  insufficient: boolean;
  emptyLabel: string;
  tone?: "default" | "positive" | "negative";
  stats: HomeCardStat[];
  caveat?: string | null;
}

export function spendHint(rows: SpendByCurrency[]): string {
  if (!rows.length) return "Sin dato de gasto";
  return rows.map((row) => formatSpendAggregate(row).value).join(" · ");
}

export function computeHomeCards(input: {
  slug: string;
  days: number;
  now: Date;
  mentions: Mention[];
  topics: Topic[];
  ads: MetaAd[];
  answers: AiAnswer[];
  suspicious: SuspiciousAccount[];
  showMetaAds?: boolean;
  timeZone?: string;
}): HomeSourceCard[] {
  const { slug, days, now } = input;
  const showMetaAds = input.showMetaAds !== false;
  const x = computeXView(input.mentions, { days, now, timeZone: input.timeZone });
  const insights = computeSuspiciousInsights(input.mentions, input.suspicious, input.topics, { days, now });
  const adsView = stanceSplit(input.ads, now);
  const activeAds = input.ads.filter((ad) => !ad.ad_delivery_stop_time || new Date(ad.ad_delivery_stop_time).getTime() > now.getTime()).length;
  const pages = new Set(input.ads.map((ad) => ad.page_id || (ad.page_name ?? "").trim().toLowerCase() || ad.ad_id));
  const ia = computeAiDashboard(input.answers);
  const favor = adsView.rows.find((r) => r.stance === "a_favor");
  const contra = adsView.rows.find((r) => r.stance === "en_contra");
  const neutral = adsView.rows.find((r) => r.stance === "neutral_otro");

  const xCaveat =
    insights.flaggedPosts > 0
      ? insights.sufficient
        ? `El volumen puede incluir cuentas marcadas como sospechosas (${insights.flaggedAuthors} en este período).`
        : "Hay cuentas marcadas como sospechosas; todavía no hay datos suficientes para medir su efecto en el balance."
      : null;

  return [
    {
      href: `/c/${slug}/x`,
      title: "En X",
      hint: `Últimos ${days} días`,
      insufficient: x.total === 0,
      emptyLabel: "datos insuficientes. Todavía no hay posts de X en este período.",
      tone: x.balance == null || x.balance === 0 ? "default" : x.balance < 0 ? "negative" : "positive",
      stats: [
        { label: "Posts", value: String(x.total) },
        { label: "Balance", value: x.balance == null ? "—" : formatXBalance(x.balance) },
        { label: "A favor", value: String(x.positiveAboutCandidate) },
        { label: "Críticas", value: String(x.negativeAboutCandidate) },
      ],
      caveat: xCaveat,
    },
    ...(showMetaAds
    ? [{
      href: `/c/${slug}/anuncios`,
      title: "Anuncios",
      hint: "Biblioteca de Meta, todo el período recolectado",
      insufficient: input.ads.length === 0,
      emptyLabel: "datos insuficientes. Todavía no hay anuncios de la Biblioteca de Meta.",
      stats: [
        { label: "Anuncios", value: String(input.ads.length) },
        { label: "Activos", value: String(activeAds) },
        { label: "Páginas", value: String(pages.size) },
        { label: "Gasto est.", value: spendHint(input.ads.length ? aggregateSpend(input.ads) : []) },
        ...(adsView.insufficient
          ? [{ label: "Clasificación", value: "datos insuficientes" }]
          : [
              { label: "A favor", value: `${favor?.ads ?? 0} (${formatShare(favor?.share ?? null)})` },
              { label: "En contra", value: `${contra?.ads ?? 0} (${formatShare(contra?.share ?? null)})` },
              { label: "Neutrales", value: `${neutral?.ads ?? 0} (${formatShare(neutral?.share ?? null)})` },
            ]),
      ],
    },
    ]
    : [{
      href: `/c/${slug}/anuncios`,
      title: "Anuncios",
      hint: "Biblioteca de Meta",
      insufficient: true,
      emptyLabel: META_ADS_EU_UNAVAILABLE,
      stats: [],
    }]),
    {
      href: `/c/${slug}/ia`,
      title: "En la IA",
      hint: ia.latestDay ? `Foto diaria del ${ia.latestDay}` : "API de OpenAI, set fijo de preguntas",
      insufficient: ia.insufficient,
      emptyLabel: ia.insufficientReason ?? "datos insuficientes.",
      tone:
        ia.overallBalance == null
          ? "default"
          : ia.overallBalance > 5
            ? "positive"
            : ia.overallBalance < -5
              ? "negative"
              : "default",
      stats: ia.insufficient
        ? []
        : [
            { label: "Balance", value: formatAiBalance(ia.overallBalance) },
            { label: "A favor", value: formatShare(ia.positiveShare) },
            { label: "En contra", value: formatShare(ia.negativeShare) },
            { label: "Neutrales", value: formatShare(ia.neutralShare) },
            {
              label: "Tendencia",
              value: ia.trendInsufficient ? "una sola foto" : `${ia.trend! > 0 ? "+" : ""}${ia.trend}`,
            },
          ],
    },
    {
      href: `/c/${slug}/sospechosas`,
      title: "Sospechosas",
      hint: `Últimos ${days} días · solo evidencia para revisión humana`,
      insufficient: input.suspicious.length === 0,
      emptyLabel: "datos insuficientes. No hay cuentas marcadas para este candidato.",
      stats: [
        { label: "Cuentas", value: String(input.suspicious.length) },
        {
          label: "Participación",
          value: insights.sufficient ? formatPercent(insights.authorShare ?? 0) : "datos insuficientes",
        },
        { label: "Posts", value: insights.sufficient ? String(insights.flaggedPosts) : "—" },
      ],
      caveat: "No se denuncia en automático. La evidencia queda para una revisión humana.",
    },
  ];
}
