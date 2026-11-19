import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/data/memory";
import { formatDateTime, parseDate } from "@/lib/time";
import {
  adSnippet,
  aggregateSpend,
  computeMetaAdsView,
  formatSpendAggregate,
  formatSpendRange,
  isAdActive,
  matchesMetaAdFilters,
  normalizeMetaAd,
  formatMetaAdDate,
  metaAdDateKey,
  publicAdLibraryUrl,
  stanceSplit,
} from "@/lib/meta-ads";
import type { MetaAd } from "@/lib/types";

const CANDIDATE = "2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e";
const NOW = new Date("2026-11-19T16:16:00-03:00");

function ad(over: Partial<MetaAd> = {}): MetaAd {
  const n = over.ad_id ?? "1001";
  return normalizeMetaAd({
    id: over.id ?? `00000000-0000-4000-8000-${n.padStart(12, "0")}`,
    candidate_id: CANDIDATE,
    ad_id: n,
    page_id: "page-ratio",
    page_name: "Ratio oficial",
    bylines: "Ratio oficial",
    publisher_platforms: ["facebook"],
    currency: "ARS",
    spend_lower: 100,
    spend_upper: 499,
    impressions_lower: 1000,
    impressions_upper: 4999,
    ad_creative_bodies: ["Texto del anuncio sobre el candidato."],
    ad_creative_link_titles: [],
    ad_snapshot_url: `https://www.facebook.com/ads/library/?id=${n}`,
    ad_creation_time: "2026-11-01T00:00:00+00:00",
    ad_delivery_start_time: "2026-11-02T00:00:00+00:00",
    ad_delivery_stop_time: "2026-11-10T00:00:00+00:00",
    fetched_at: "2026-11-19T19:16:01.756Z",
    fetched_on: "2026-11-19",
    ...over,
  });
}

describe("URLs y normalización", () => {
  it("arma la URL pública y tira cualquier token del snapshot de la API", () => {
    expect(publicAdLibraryUrl("123")).toBe("https://www.facebook.com/ads/library/?id=123");
    const raw =
      "https://www.facebook.com/ads/archive/render_ad/?id=123&access_token=EAAG-SECRET-NO-USAR";
    const clean = normalizeMetaAd(
      ad({
        ad_id: "123",
        ad_snapshot_url: raw,
        page_name: "  Ratio oficial        ",
        spend_lower: "1000" as unknown as number,
        spend_upper: "1499" as unknown as number,
      }),
    );
    expect(clean.ad_snapshot_url).toBe("https://www.facebook.com/ads/library/?id=123");
    expect(clean.ad_snapshot_url).not.toContain("access_token");
    expect(clean.ad_snapshot_url).not.toContain("EAAG");
    expect(clean.page_name).toBe("Ratio oficial");
    expect(clean.spend_lower).toBe(1000);
    expect(clean.spend_upper).toBe(1499);
  });

  it("parsea fechas de Postgres con +00", () => {
    expect(Number.isNaN(parseDate("2026-11-19T19:16:01.756016+00").getTime())).toBe(false);
    expect(Number.isNaN(parseDate("2026-11-19 19:16:01.756016+00").getTime())).toBe(false);
    expect(formatDateTime("2026-11-19T19:16:01.756016+00")).toBe("19/11/2026, 16:16");
  });

  it("usa el día civil de Meta y no lo atrasa a hora de Argentina", () => {
    expect(metaAdDateKey("2026-11-19T00:00:00+00:00")).toBe("2026-11-19");
    expect(formatMetaAdDate("2026-11-19T00:00:00+00:00")).toBe("19/11/2026");
    expect(formatMetaAdDate("2026-02-06T00:00:00+00:00")).toBe("06/02/2026");
  });

  it("arma un recorte del texto y no inventa copy", () => {
    expect(adSnippet(ad())).toBe("Texto del anuncio sobre el candidato.");
    expect(adSnippet(ad({ ad_creative_bodies: [], ad_creative_link_titles: ["Título"] }))).toBe("Título");
    expect(adSnippet(ad({ ad_creative_bodies: [], ad_creative_link_titles: [] }))).toBe("Sin texto del anuncio");
    expect(adSnippet(ad({ ad_creative_bodies: ["a".repeat(300)] })).endsWith("…")).toBe(true);
  });
});

describe("rangos de gasto", () => {
  it("formatea un rango cerrado, un techo abierto y un piso abierto, sin inventar un punto medio", () => {
    expect(formatSpendRange("ARS", 100, 499)).toBe("ARS 100 – 499");
    expect(formatSpendRange("ARS", 1_000_000, null)).toBe("ARS 1.000.000 o más");
    expect(formatSpendRange("USD", null, 99)).toBe("USD hasta 99");
    expect(formatSpendRange("ARS", null, null)).toBe("Sin dato de gasto");
    expect(formatSpendRange("USD", 300, 300)).toBe("USD 300");
  });

  it("suma cotas por moneda y marca el techo abierto, sin mezclar monedas", () => {
    const rows = aggregateSpend([
      ad({ ad_id: "1", currency: "ARS", spend_lower: 100, spend_upper: 499 }),
      ad({ ad_id: "2", currency: "ARS", spend_lower: 1_000_000, spend_upper: null }),
      ad({ ad_id: "3", currency: "USD", spend_lower: 100, spend_upper: 499 }),
      ad({ ad_id: "4", currency: "USD", spend_lower: 200, spend_upper: 299 }),
    ]);
    const ars = rows.find((r) => r.currency === "ARS")!;
    const usd = rows.find((r) => r.currency === "USD")!;
    expect(ars.lowerSum).toBe(1_000_100);
    expect(ars.upperSum).toBe(499);
    expect(ars.openUpper).toBe(1);
    expect(usd.lowerSum).toBe(300);
    expect(usd.upperSum).toBe(798);
    expect(usd.openUpper).toBe(0);
    const formatted = formatSpendAggregate(ars);
    expect(formatted.openEnded).toBe(true);
    expect(formatted.value).toContain("1.000.100");
    expect(formatted.value).toContain("499+");
    expect(formatted.hint).toMatch(/no tienen techo|no tiene techo/);
    expect(formatted.hint).not.toMatch(/1\.000\.599|promedio|estimado exacto/i);
    expect(formatSpendAggregate(usd).value).toBe("USD 300 – 798");
    expect(formatSpendAggregate(usd).openEnded).toBe(false);
  });
});

describe("agregados de la vista de anuncios", () => {
  const rows = [
    ad({
      ad_id: "1",
      page_id: "p1",
      page_name: "Ratio oficial",
      spend_lower: 100,
      spend_upper: 499,
      ad_delivery_start_time: "2026-02-06T00:00:00+00:00",
      ad_delivery_stop_time: "2026-02-20T00:00:00+00:00",
    }),
    ad({
      ad_id: "2",
      page_id: "p1",
      page_name: "Ratio oficial",
      spend_lower: 200,
      spend_upper: 299,
      ad_delivery_start_time: "2026-11-10T00:00:00+00:00",
      ad_delivery_stop_time: null,
    }),
    ad({
      ad_id: "3",
      page_id: "p2",
      page_name: "La Política Online",
      currency: "USD",
      spend_lower: 100,
      spend_upper: 499,
      ad_delivery_start_time: "2026-10-01T00:00:00+00:00",
      ad_delivery_stop_time: "2026-10-15T00:00:00+00:00",
    }),
    ad({
      ad_id: "4",
      page_id: "p3",
      page_name: "Matanza City",
      spend_lower: 1_000_000,
      spend_upper: null,
      ad_delivery_start_time: "2026-11-01T00:00:00+00:00",
      ad_delivery_stop_time: "2026-11-18T00:00:00+00:00",
    }),
  ];

  it("cuenta totales, páginas activas, período y volumen mensual en 'todo'", () => {
    const view = computeMetaAdsView(rows, { days: "all", now: NOW, pageSize: 2 });
    expect(view.insufficient).toBe(false);
    expect(view.total).toBe(4);
    expect(view.pages).toBe(3);
    expect(view.active).toBe(1);
    expect(view.topPages[0]).toMatchObject({ pageName: "Ratio oficial", ads: 2, active: 1 });
    expect(view.volumeBucket).toBe("month");
    const feb = view.volume.find((p) => p.key === "2026-02");
    const nov = view.volume.find((p) => p.key === "2026-11");
    expect(feb?.total).toBe(1);
    expect(nov?.total).toBe(2);
    expect(view.items).toHaveLength(2);
    expect(view.filteredTotal).toBe(4);
    expect(isAdActive(rows[1], NOW)).toBe(true);
    expect(isAdActive(rows[0], NOW)).toBe(false);
  });

  it("filtra por período de solapamiento y por estado o moneda", () => {
    const last30 = computeMetaAdsView(rows, { days: 30, now: NOW });
    // El de febrero ya había cortado; el de octubre cortó el 15, antes de la ventana.
    expect(last30.total).toBe(2);
    expect(last30.volumeBucket).toBe("day");
    expect(last30.active).toBe(1);
    const usd = computeMetaAdsView(rows, { days: "all", now: NOW, filters: { currency: "USD" } });
    expect(usd.filteredTotal).toBe(1);
    expect(usd.total).toBe(4);
    expect(usd.items[0].page_name).toBe("La Política Online");
    const activos = computeMetaAdsView(rows, { days: "all", now: NOW, filters: { status: "activo" } });
    expect(activos.filteredTotal).toBe(1);
    expect(matchesMetaAdFilters(rows[0], { q: "candidato" }, NOW)).toBe(true);
    expect(matchesMetaAdFilters(rows[0], { q: "inexistente" }, NOW)).toBe(false);
  });

  it("dice datos insuficientes solo cuando no hay anuncios", () => {
    const empty = computeMetaAdsView([], { days: "all", now: NOW });
    expect(empty.insufficient).toBe(true);
    expect(empty.total).toBe(0);
    expect(empty.spend).toEqual([]);
  });
});

describe("MemoryRepo.listMetaAds", () => {
  it("no mezcla candidatos y sanitiza la URL del snapshot", async () => {
    const repo = new MemoryRepo({
      candidate: { id: CANDIDATE, slug: "axel-kicillof", name: "Axel Kicillof" },
      topics: [],
      mentions: [],
      source_runs: [],
      candidate_sources: [],
      meta_ads: [
        {
          ...ad({ ad_id: "9" }),
          ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=9&access_token=SECRET",
        },
        ad({ ad_id: "10", candidate_id: "otro" }),
      ],
    });
    const rows = await repo.listMetaAds(CANDIDATE);
    expect(rows).toHaveLength(1);
    expect(rows[0].ad_id).toBe("9");
    expect(rows[0].ad_snapshot_url).toBe("https://www.facebook.com/ads/library/?id=9");
    expect(rows[0].ad_snapshot_url).not.toContain("access_token");
    expect(await repo.listMetaAds("otro")).toHaveLength(1);
  });
});

describe("clasificación de anuncios", () => {
  it("parte a favor, en contra y neutrales, con gasto por grupo, y no cuenta los sin etiqueta en el porcentaje", () => {
    const rows = [
      ad({ ad_id: "1", stance: "a_favor", spend_lower: 100, spend_upper: 199 }),
      ad({ ad_id: "2", stance: "a_favor", spend_lower: 200, spend_upper: 299 }),
      ad({ ad_id: "3", stance: "en_contra", spend_lower: 1000, spend_upper: 1499 }),
      ad({ ad_id: "4", stance: "neutral_otro", spend_lower: 10, spend_upper: 20 }),
      ad({ ad_id: "5", stance: null, spend_lower: 50, spend_upper: 60 }),
    ];
    const split = stanceSplit(rows, NOW);
    expect(split.classified).toBe(4);
    expect(split.unclassified).toBe(1);
    expect(split.insufficient).toBe(false);
    const favor = split.rows.find((r) => r.stance === "a_favor")!;
    const contra = split.rows.find((r) => r.stance === "en_contra")!;
    expect(favor.ads).toBe(2);
    expect(favor.share).toBe(0.5);
    expect(favor.spend[0].lowerSum).toBe(300);
    expect(contra.ads).toBe(1);
    expect(contra.share).toBe(0.25);
    expect(stanceSplit([], NOW).insufficient).toBe(true);
  });

  it("filtra por postura, incluido sin clasificar, y el agregado de la vista lo expone", () => {
    const rows = [
      ad({ ad_id: "1", stance: "a_favor" }),
      ad({ ad_id: "2", stance: "en_contra" }),
      ad({ ad_id: "3", stance: null }),
    ];
    expect(matchesMetaAdFilters(rows[0], { stance: "a_favor" }, NOW)).toBe(true);
    expect(matchesMetaAdFilters(rows[1], { stance: "a_favor" }, NOW)).toBe(false);
    expect(matchesMetaAdFilters(rows[2], { stance: "sin_clasificar" }, NOW)).toBe(true);
    expect(matchesMetaAdFilters(rows[0], { stance: "sin_clasificar" }, NOW)).toBe(false);
    const view = computeMetaAdsView(rows, { days: "all", now: NOW, filters: { stance: "en_contra" } });
    expect(view.filteredTotal).toBe(1);
    expect(view.items[0].ad_id).toBe("2");
    expect(view.classification.classified).toBe(2);
  });
});
