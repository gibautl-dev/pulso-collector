/**
 * Prueba deploy/approve_activates_rival.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const S = "cccccccc-0000-0000-0000-000000000003";
const C1 = "11111111-0000-0000-0000-000000000001";
const PENDING = "b1000000-0000-4000-8000-000000000025";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role pulso_collector nologin;
    create role pulso_classifier nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, pulso_collector, pulso_classifier;
    grant usage on schema public to anon, authenticated, service_role, pulso_collector, pulso_classifier;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(read("schema.sql"));
  await db.exec("alter table public.mentions add column if not exists relevance text;");
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(read("deploy/candidate_rivals.sql"));
  await db.exec(read("deploy/rival_suggestions.sql"));
  await db.exec(read("deploy/pending_candidates_ux.sql"));
  await db.exec(read("deploy/approve_activates_rival.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${S}','staff@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}');
    update candidate_sources
       set enabled = true,
           settings = '{"feeds":["https://www.clarin.com/rss/politica/"],"own_domains":["gba.gob.ar"],"reference_domains":[]}'::jsonb
     where candidate_id = '${C1}' and source = 'rss_media';
    update candidate_sources
       set enabled = true, settings = '{}'::jsonb
     where candidate_id = '${C1}' and source = 'google_news';
    insert into candidate_members values ('${C1}','${A}');
    insert into pulso_staff (user_id, note) values ('${S}', 'test');
    insert into pending_candidates (
      id, name, slug, arena, status, requested_for_candidate_id, requested_level, source
    ) values (
      '${PENDING}', 'Javier Milei', 'milei', 'Argentina', 'pendiente_de_alta', '${C1}', 'comparativo', 'manual'
    );
  `);
});

async function asStaff(sql: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${S}', false); set role authenticated;`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

async function asMember(sql: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${A}', false); set role authenticated;`);
  try {
    return await db.query(sql);
  } catch (err) {
    return { error: String(err) };
  } finally {
    await db.exec("reset role");
  }
}

describe("approve_activates_rival.sql", () => {
  it("activa medios/RSS, crea el rival comparativo y es idempotente", async () => {
    const denied = await asMember(
      `select public.approve_and_activate_pending_candidate('${PENDING}'::uuid, false)`,
    );
    expect("error" in denied).toBe(true);

    const first = await asStaff(
      `select public.approve_and_activate_pending_candidate('${PENDING}'::uuid, false) as payload`,
    );
    const payload = (first.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.status).toBe("aprobado");
    expect(payload.created_candidate).toBe(true);
    expect(payload.enable_ia).toBe(false);
    const rivalId = payload.activated_candidate_id as string;

    const cand = await db.query(
      `select slug, name, keywords from public.candidates where id = '${rivalId}'`,
    );
    expect(cand.rows[0]).toMatchObject({
      slug: "milei",
      name: "Javier Milei",
      keywords: ["Javier Milei", "Milei"],
    });

    const sources = await db.query(
      `select source, enabled, settings from public.candidate_sources where candidate_id = '${rivalId}' order by source`,
    );
    const bySource = Object.fromEntries(
      (sources.rows as { source: string; enabled: boolean; settings: { feeds?: string[]; own_domains?: string[] } }[]).map(
        (row) => [row.source, row],
      ),
    );
    expect(bySource.rss_media.enabled).toBe(true);
    expect(bySource.rss_media.settings.feeds).toEqual(["https://www.clarin.com/rss/politica/"]);
    expect(bySource.rss_media.settings.own_domains).toEqual([]);
    expect(bySource.google_news.enabled).toBe(true);
    expect(bySource.x.enabled).toBe(false);
    expect(bySource.llm.enabled).toBe(false);

    const link = await db.query(
      `select level from public.candidate_rivals where candidate_id = '${C1}' and rival_id = '${rivalId}'`,
    );
    expect(link.rows[0]).toMatchObject({ level: "comparativo" });

    const second = await asStaff(
      `select public.approve_and_activate_pending_candidate('${PENDING}'::uuid, false) as payload`,
    );
    const again = (second.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(again.created_candidate).toBe(false);
    expect(again.activated_candidate_id).toBe(rivalId);
    const count = await db.query(`select count(*)::int as n from public.candidates where slug = 'milei'`);
    expect((count.rows[0] as { n: number }).n).toBe(1);
    const rivals = await db.query(
      `select count(*)::int as n from public.candidate_rivals where candidate_id = '${C1}' and rival_id = '${rivalId}'`,
    );
    expect((rivals.rows[0] as { n: number }).n).toBe(1);
  });
});
