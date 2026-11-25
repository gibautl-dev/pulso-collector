import Link from "next/link";
import { ComparisonVolumeChart } from "@/components/comparison-volume-chart";
import { CreativeAdCardView } from "@/components/creative-ad-card";
import { Card, EmptyState, HBar, PageHeader, Stat } from "@/components/ui";
import { loadCandidate } from "@/lib/context";
import { RIVAL_LEVEL_LABEL } from "@/lib/labels";
import { META_ADS_EU_UNAVAILABLE, regionFor } from "@/lib/region";
import { mentionHeadline } from "@/lib/mention-excerpt";
import { formatSharePct, rivalCreativeCards, rivalMetaStats, shareOfVoice } from "@/lib/rival-ads";
import { buildRivalComparison, type SubjectPack } from "@/lib/rivals";
import { computeDashboard } from "@/lib/analytics";
import { clockFor } from "@/lib/time";
import { formatBalance as formatAiBalance } from "@/lib/ai-visibility";
import { balanceCaption, balanceTone, formatBalance } from "@/lib/x-posts";
import type { Candidate, CandidateRival, MetaAd, RivalLevel } from "@/lib/types";

export const metadata = { title: "Rivales y anuncios · Pulso" };
const PERIODS = [7, 14, 30];

function overallBalance(pack: {
  dashboard: {
    toneAboutCandidate: { count: number }[];
    positiveAboutCandidate: number;
    negativeAboutCandidate: number;
  };
}): number | null {
  const classified = pack.dashboard.toneAboutCandidate.reduce((s, t) => s + t.count, 0);
  if (!classified) return null;
  return Math.round(((pack.dashboard.positiveAboutCandidate - pack.dashboard.negativeAboutCandidate) / classified) * 100);
}

async function loadPack(
  repo: Awaited<ReturnType<typeof loadCandidate>>["repo"],
  candidate: Candidate,
  since: string,
): Promise<SubjectPack> {
  const [mentions, topics, ads, answers, suspicious] = await Promise.all([
    repo.mentionsSince(candidate.id, since),
    repo.listTopics(candidate.id),
    repo.listMetaAds(candidate.id),
    repo.listAiAnswers(candidate.id),
    repo.listSuspiciousAccounts(candidate.id),
  ]);
  return { candidate, mentions, topics, ads, answers, suspicious };
}

export default async function ComparacionPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/comparacion">) {
  const { slug } = await params;
  const clock = clockFor(slug);
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const { repo, candidate, viewer } = await loadCandidate(slug);
  const rivals = await repo.listRivals(candidate.id);
  const resolved: { assignment: CandidateRival; rival: Candidate }[] = [];
  for (const row of rivals) {
    const rival = await repo.getCandidateById(row.rival_id);
    if (rival) resolved.push({ assignment: row, rival });
  }
  const wanted = typeof sp.rival === "string" ? sp.rival : null;
  const current = resolved.find((r) => r.rival.slug === wanted) ?? resolved[0] ?? null;

  const ts = await repo.dataTimestamp();
  const now = ts ? new Date(ts) : new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();

  const region = regionFor(slug);
  const [parentMeta, parentGoogle, parentMentions, rivalPacks] = await Promise.all([
    region.showMetaAds ? repo.listMetaAds(candidate.id) : Promise.resolve([] as MetaAd[]),
    repo.listGoogleAds(candidate.id),
    repo.mentionsSince(candidate.id, since),
    Promise.all(
      resolved.map(async (row) => {
        const mentions = await repo.mentionsSince(row.rival.id, since);
        return { rival: row.rival, mentions };
      }),
    ),
  ]);
  const parentDash = computeDashboard(parentMentions, await repo.listTopics(candidate.id), {
    days,
    now,
    timeZone: clock.timeZone,
  });
  const sov = shareOfVoice([
    { id: candidate.id, name: candidate.name, slug: candidate.slug, self: true, mentions: parentDash.total },
    ...rivalPacks.map(({ rival, mentions }) => ({
      id: rival.id,
      name: rival.name,
      slug: rival.slug,
      self: false,
      mentions: computeDashboard(mentions, [], { days, now, timeZone: clock.timeZone }).total,
    })),
  ]);
  const pauta = region.showMetaAds ? rivalMetaStats(parentMeta, resolved.map((r) => r.rival), now) : [];
  const creatives = rivalCreativeCards(parentMeta, parentGoogle, resolved.map((r) => r.rival), now);

  let comparison = null as ReturnType<typeof buildRivalComparison> | null;
  if (current) {
    const [left, right] = await Promise.all([
      loadPack(repo, candidate, since),
      loadPack(repo, current.rival, since),
    ]);
    comparison = buildRivalComparison(left, right, {
      days,
      now,
      level: current.assignment.level,
      timeZone: clock.timeZone,
    });
  }

  return (
    <>
      <PageHeader
        title={`Rivales y anuncios · ${candidate.name}`}
        description="Conversación comparada y anuncios de rivales, con los datos que Pulso ya recolecta."
      >
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/c/${slug}/comparacion?dias=${p}${current ? `&rival=${current.rival.slug}` : ""}`}
              className={`rounded-md px-3 py-1.5 font-medium ${p === days ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {p} días
            </Link>
          ))}
        </div>
      </PageHeader>

      {viewer.fixture ? (
        <p className="mb-6 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
          Modo local de prueba: las asignaciones de rivales de esta vista son de demostración para ver la interfaz, no una carga oficial.
        </p>
      ) : null}

      {resolved.length > 1 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {resolved.map((row) => {
            const active = current?.rival.id === row.rival.id;
            return (
              <Link
                key={row.rival.id}
                href={`/c/${slug}/comparacion?dias=${days}&rival=${row.rival.slug}`}
                className={`rounded-full border px-3 py-1 text-sm font-medium ${
                  active ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {row.rival.name}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  {RIVAL_LEVEL_LABEL[row.assignment.level]}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}


      <div data-testid="rivales-hero" className="mb-6 space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Quién domina la conversación" subtitle={`Menciones en los últimos ${days} días.`}>
          {resolved.length === 0 ? (
            <EmptyState>Todavía no hay rivales asignados.</EmptyState>
          ) : (
            <div className="space-y-3">
              {sov.map((row) => {
                const max = Math.max(1, ...sov.map((r) => r.mentions));
                return (
                  <HBar
                    key={row.id}
                    label={`${row.name}${row.self ? " (tu candidato)" : ""}`}
                    value={row.mentions}
                    max={max}
                    barClass={row.self ? "bg-violet-600" : "bg-slate-300"}
                    extra={<span className="ml-1.5 text-xs text-slate-500">· {formatSharePct(row.share)}</span>}
                  />
                );
              })}
            </div>
          )}
        </Card>
        <Card
          title="Pauta de rivales"
          subtitle={region.showMetaAds ? "Anuncios de Meta de cada rival." : "Anuncios de Meta"}
        >
          {!region.showMetaAds ? (
            <p className="text-sm text-slate-600">{META_ADS_EU_UNAVAILABLE}</p>
          ) : pauta.length === 0 ? (
            <EmptyState>Todavía no hay rivales asignados.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {pauta.map((row) => (
                <div key={row.rival.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="font-semibold text-slate-900">{row.rival.name}</p>
                  {row.unmatched ? (
                    <p className="mt-2 text-sm text-slate-600">No hay anuncios de Meta cuyo anunciante coincida con este rival.</p>
                  ) : (
                    <>
                      <div className="mt-3 flex gap-6">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Anuncios</p>
                          <p className="text-2xl font-semibold tabular-nums text-slate-900">{row.ads}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Activos</p>
                          <p className="text-2xl font-semibold tabular-nums text-emerald-600">{row.active}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">
                        En contra de tu candidato:{" "}
                        <span className="font-semibold text-rose-600">
                          {row.againstShare == null ? "sin clasificar" : formatSharePct(row.againstShare)}
                        </span>
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Anuncios de rivales"
        subtitle="Texto de los anuncios, cuando está disponible."
        className="mb-6"
      >
        {creatives.length === 0 ? (
          <EmptyState>
            {resolved.length === 0
              ? "Cuando haya rivales asignados, acá van a aparecer sus anuncios."
              : "No hay anuncios de estos rivales por ahora."}
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {creatives.map((card) => (
              <CreativeAdCardView key={card.id} card={card} />
            ))}
          </div>
        )}
      </Card>
      </div>
      {!current || !comparison ? (
        <EmptyState>
          Todavía no hay una comparación. Cuando el equipo de Active asigne rivales para este candidato, acá vas a ver el contraste listo, según el nivel elegido (Radar, Comparativo o Completo).
        </EmptyState>
      ) : (
        <ComparisonBody
          slug={slug}
          level={current.assignment.level}
          comparison={comparison}
          clock={clock}
        />
      )}
    </>
  );
}

function ComparisonBody({
  slug,
  level,
  comparison,
  clock,
}: {
  slug: string;
  level: RivalLevel;
  comparison: NonNullable<ReturnType<typeof buildRivalComparison>>;
  clock: ReturnType<typeof clockFor>;
}) {
  const { candidate, rival, volumeVs, adsRanking } = comparison;
  const leftBal = overallBalance(candidate);
  const rightBal = overallBalance(rival);
  const showAds = candidate.showMetaAds || rival.showMetaAds;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Nivel <span className="font-semibold text-slate-900">{RIVAL_LEVEL_LABEL[level]}</span>
        {" · "}
        Frente a {rival.candidate.name}.
      </p>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Menciones · ${candidate.candidate.name}`} value={candidate.dashboard.total} />
        <Stat label={`Menciones · ${rival.candidate.name}`} value={rival.dashboard.total} />
        <Stat label={`Balance · ${candidate.candidate.name}`} value={leftBal == null ? "—" : formatBalance(leftBal)} tone={balanceTone(leftBal)} hint={balanceCaption(leftBal)} />
        <Stat label={`Balance · ${rival.candidate.name}`} value={rightBal == null ? "—" : formatBalance(rightBal)} tone={balanceTone(rightBal)} hint={balanceCaption(rightBal)} />
      </div>

      <Card title="Curvas de volumen" subtitle="Menciones por día.">
        {volumeVs.length === 0 ? (
          <p className="text-sm text-slate-500">No hay volumen en esta ventana.</p>
        ) : (
          <ComparisonVolumeChart
            data={volumeVs}
            candidateName={candidate.candidate.name}
            rivalName={rival.candidate.name}
            clock={clock}
          />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <SideCard snapshot={candidate} level={level} self />
        <SideCard snapshot={rival} level={level} />
      </div>

      {level !== "radar" && showAds ? (
        <Card title="Anuncios" subtitle="Páginas que más pautaron en el período.">
          {adsRanking.length === 0 ? (
            <p className="text-sm text-slate-500">
              No hay anuncios para mostrar. En algunas regiones esta fuente no está activa.
            </p>
          ) : (
            <ul className="space-y-2">
              {adsRanking.map((row) => {
                const max = Math.max(1, row.candidate, row.rival);
                return (
                  <li key={row.page} className="text-sm">
                    <p className="font-medium text-slate-800">{row.page}</p>
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      <div>
                        <HBar label={`${candidate.candidate.name}: ${row.candidate}`} value={row.candidate} max={max} barClass="bg-indigo-600" />
                      </div>
                      <div>
                        <HBar label={`${rival.candidate.name}: ${row.rival}`} value={row.rival} max={max} barClass="bg-slate-400" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {level === "radar" || candidate.mediaHighlights.length || rival.mediaHighlights.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <MediaList name={candidate.candidate.name} items={candidate.mediaHighlights} slug={slug} />
          <MediaList name={rival.candidate.name} items={rival.mediaHighlights} />
        </div>
      ) : null}
    </div>
  );
}

function SideCard({
  snapshot,
  level,
  self,
}: {
  snapshot: ReturnType<typeof buildRivalComparison>["candidate"];
  level: RivalLevel;
  self?: boolean;
}) {
  const name = snapshot.candidate.name;
  return (
    <Card title={name} subtitle={self ? "Este candidato" : `Rival · ${RIVAL_LEVEL_LABEL[level]}`}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Medios</dt>
          <dd className="mt-1 font-semibold tabular-nums">{snapshot.mediaCount}</dd>
        </div>
        {snapshot.showX ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">En X</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {snapshot.xTotal ?? "—"}
              {snapshot.xBalance != null ? (
                <span className="ml-1 text-xs font-normal text-slate-500">{formatBalance(snapshot.xBalance)}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {snapshot.showAi ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">En la IA</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {snapshot.aiAnswers}
              {snapshot.aiBalance != null ? (
                <span className="ml-1 text-xs font-normal text-slate-500">{formatAiBalance(snapshot.aiBalance)}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {level !== "radar" ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Anuncios</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {!snapshot.showMetaAds
                ? "No aplica en esta región"
                : snapshot.adsActive == null
                  ? "—"
                  : `${snapshot.adsActive} activos`}
            </dd>
            {snapshot.showMetaAds && snapshot.adsAgainst != null ? (
              <p className="text-xs text-slate-500">{snapshot.adsAgainst} en contra</p>
            ) : null}
            {snapshot.adsSpendHint ? <p className="text-xs text-slate-500">{snapshot.adsSpendHint}</p> : null}
          </div>
        ) : null}
        {snapshot.showSuspicious ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Sospechosas</dt>
            <dd className="mt-1 font-semibold tabular-nums">{snapshot.suspiciousCount ?? "—"}</dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}

function MediaList({
  name,
  items,
  slug,
}: {
  name: string;
  items: ReturnType<typeof buildRivalComparison>["candidate"]["mediaHighlights"];
  slug?: string;
}) {
  return (
    <Card title={`Medios · ${name}`} subtitle="Menciones negativas recientes, si las hay.">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No hay menciones negativas de medios en esta ventana.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((m) => (
            <li key={m.id}>
              {slug ? (
                <Link href={`/c/${slug}/menciones/${m.id}`} className="font-medium text-indigo-700 hover:underline">
                  {mentionHeadline(m)}
                </Link>
              ) : (
                <span className="font-medium text-slate-800">{mentionHeadline(m)}</span>
              )}
              <p className="text-xs text-slate-500">{[m.outlet, m.published_at.slice(0, 10)].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
