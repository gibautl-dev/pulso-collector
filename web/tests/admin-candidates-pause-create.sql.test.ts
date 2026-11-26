/**
 * Prueba deploy/admin_candidates_pause_create.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const STAFF = "cccccccc-0000-0000-0000-000000000003";
const MEMBER = "aaaaaaaa-0000-0000-0000-000000000001";
const DEMO = "dddddddd-0000-0000-0000-00000000000d";
const RICARDO = "eeeeeeee-0000-0000-0000-00000000000e";
const KICI = "11111111-0000-0000-0000-000000000001";
const MILEI = "22222222-0000-0000-0000-000000000002";
const PEDRO = "33333333-0000-0000-0000-000000000003";
let db: PGlite;

const SHARED_AR = [
  "https://www.clarin.com/rss/politica/",
  "https://www.lanacion.com.ar/politica/rss/",
  "https://www.infobae.com/arc/outboundfeeds/rss/",
];
const GBA = "https://www.gba.gob.ar/rss.xml";
const CASA = "https://www.casarosada.gob.ar/discursos/feed";
const SHARED_ES = ["https://elpais.com/rss/politica.xml", "https://www.elmundo.es/rss/espana.xml"];

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
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(read("deploy/candidate_rivals.sql"));
  await db.exec(`
    insert into auth.users values
      ('${MEMBER}','member@x.com'),
      ('${STAFF}','info@activemkt.com'),
      ('${DEMO}','demo@activemkt.com'),
      ('${RICARDO}','ricardohugogomez@gmail.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${KICI}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${MILEI}','milei','Javier Milei','{milei}','{}'),
      ('${PEDRO}','pedro-sanchez','Pedro Sánchez','{sanchez}','{}');
    update candidate_sources
       set enabled = true,
           settings = jsonb_build_object('feeds', '${JSON.stringify([...SHARED_AR, GBA])}'::jsonb, 'own_domains', jsonb_build_array('gba.gob.ar'))
     where candidate_id = '${KICI}' and source = 'rss_media';
    update candidate_sources
       set enabled = true,
           settings = jsonb_build_object('feeds', '${JSON.stringify([...SHARED_AR, CASA])}'::jsonb, 'own_domains', jsonb_build_array('casarosada.gob.ar'))
     where candidate_id = '${MILEI}' and source = 'rss_media';
    update candidate_sources
       set enabled = true,
           settings = jsonb_build_object('feeds', '${JSON.stringify(SHARED_ES)}'::jsonb)
     where candidate_id = '${PEDRO}' and source = 'rss_media';
    insert into candidate_members (candidate_id, user_id) values
      ('${KICI}','${MEMBER}'),
      ('${KICI}','${STAFF}');
    insert into pulso_staff (user_id, note) values
      ('${STAFF}', 'staff'),
      ('${DEMO}', 'should be excluded by email'),
      ('${RICARDO}', 'should be excluded by email');
    -- schema.sql ya trae las columnas con default; las vaciamos para probar el backfill.
    alter table public.candidates
      alter column country drop not null,
      alter column collection_mode drop not null;
    update public.candidates set country = null, collection_mode = null;
  `);
  await db.exec(read("deploy/admin_candidates_pause_create.sql"));
});

async function asStaff(sql: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${STAFF}', false); set role authenticated;`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

async function asMember(sql: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${MEMBER}', false); set role authenticated;`);
  try {
    return await db.query(sql);
  } catch (err) {
    return { error: String(err) };
  } finally {
    await db.exec("reset role");
  }
}

describe("admin_candidates_pause_create.sql", () => {
  it("rellena país y modo en los candidatos existentes", async () => {
    const rows = await db.query<{ slug: string; country: string; collection_mode: string; collection_paused: boolean }>(
      "select slug, country, collection_mode, collection_paused from candidates order by slug",
    );
    const bySlug = Object.fromEntries(rows.rows.map((r) => [r.slug, r]));
    expect(bySlug["axel-kicillof"].country).toBe("AR");
    expect(bySlug["axel-kicillof"].collection_mode).toBe("full");
    expect(bySlug["milei"].collection_mode).toBe("media_only");
    expect(bySlug["pedro-sanchez"].country).toBe("ES");
    expect(bySlug["pedro-sanchez"].collection_mode).toBe("full");
    expect(bySlug["axel-kicillof"].collection_paused).toBe(false);
  });

  it("solo el equipo puede pausar, y pausar no borra al candidato", async () => {
    const denied = await asMember(`select public.set_candidate_collection_paused('${KICI}'::uuid, true)`);
    expect("error" in denied).toBe(true);
    await asStaff(`select public.set_candidate_collection_paused('${KICI}'::uuid, true)`);
    const row = await db.query<{ collection_paused: boolean; name: string }>(
      `select collection_paused, name from candidates where id = '${KICI}'`,
    );
    expect(row.rows[0].collection_paused).toBe(true);
    expect(row.rows[0].name).toBe("Axel Kicillof");
    await asStaff(`select public.set_candidate_collection_paused('${KICI}'::uuid, false)`);
  });

  it("crea un candidato AR con preset compartido, sin feeds oficiales, y da admin solo al staff", async () => {
    const created = await asStaff(`
      select public.create_candidate(
        'Diego Santilli', 'diego-santilli', 'AR', 'full',
        'Jefe de Gabinete de Ministros de la Nación', 'PRO / La Libertad Avanza',
        array['Diego Santilli','Santilli','@diegosantilli'], null,
        '@diegosantilli', 'UCTtJfqABtqN8ZOWIiho8VGA', 'Diego_Santilli',
        '${KICI}'::uuid, 'comparativo', 1.00, false
      ) as created
    `);
    expect("error" in created).toBe(false);
    const payload = (created as { rows: { created: { id: string; slug: string; name: string } }[] }).rows[0].created;
    expect(payload.slug).toBe("diego-santilli");
    expect(payload.name).toBe("Diego Santilli");

    const cand = await db.query<{ country: string; collection_mode: string; office: string }>(
      `select country, collection_mode, office from candidates where slug = 'diego-santilli'`,
    );
    expect(cand.rows[0].country).toBe("AR");
    expect(cand.rows[0].collection_mode).toBe("full");
    expect(cand.rows[0].office).toContain("Jefe de Gabinete");

    const rss = await db.query<{ enabled: boolean; settings: { feeds: string[] } }>(
      `select enabled, settings from candidate_sources
        where candidate_id = '${payload.id}' and source = 'rss_media'`,
    );
    expect(rss.rows[0].enabled).toBe(true);
    const feeds = rss.rows[0].settings.feeds;
    expect(feeds).toHaveLength(29);
    expect(feeds).toContain("https://www.clarin.com/rss/politica/");
    expect(feeds.some((f) => f.includes("gba.gob.ar") || f.includes("casarosada.gob.ar"))).toBe(false);

    const sources = await db.query<{ source: string; enabled: boolean }>(
      `select source, enabled from candidate_sources where candidate_id = '${payload.id}' order by source`,
    );
    const bySource = Object.fromEntries(sources.rows.map((r) => [r.source, r.enabled]));
    expect(bySource.google_news).toBe(true);
    expect(bySource.gdelt).toBe(true);
    expect(bySource.x).toBe(true);
    expect(bySource.youtube).toBe(true);
    expect(bySource.google_alerts).toBe(false);

    const members = await db.query<{ email: string; role: string }>(
      `select u.email, m.role
         from candidate_members m
         join auth.users u on u.id = m.user_id
        where m.candidate_id = '${payload.id}'
        order by u.email`,
    );
    expect(members.rows).toEqual([{ email: "info@activemkt.com", role: "admin" }]);

    const rival = await db.query<{ rival_id: string; level: string }>(
      `select rival_id, level from candidate_rivals where candidate_id = '${payload.id}'`,
    );
    expect(rival.rows[0].rival_id).toBe(KICI);
    expect(rival.rows[0].level).toBe("comparativo");
  });

  it("aplica el preset de España y rechaza un slug repetido", async () => {
    const created = await asStaff(`
      select public.create_candidate(
        'Nuevo Demo ES', 'nuevo-demo-es', 'ES', 'media_only',
        null, null, array['Nuevo Demo'], null, null, null, null, null, null, 1.00, false
      ) as created
    `);
    const payload = (created as { rows: { created: { id: string } }[] }).rows[0].created;
    const rss = await db.query<{ settings: { feeds: string[] } }>(
      `select settings from candidate_sources where candidate_id = '${payload.id}' and source = 'rss_media'`,
    );
    expect(rss.rows[0].settings.feeds).toHaveLength(17);
    expect(rss.rows[0].settings.feeds).toContain("https://www.newtral.es/feed/");
    expect(rss.rows[0].settings.feeds).toContain("https://maldita.es/feed");
    const news = await db.query<{ settings: Record<string, string> }>(
      `select settings from candidate_sources where candidate_id = '${payload.id}' and source = 'google_news'`,
    );
    expect(news.rows[0].settings.hl).toBe("es");
    expect(news.rows[0].settings.gl).toBe("ES");
    const mode = await db.query<{ collection_mode: string; country: string }>(
      `select collection_mode, country from candidates where id = '${payload.id}'`,
    );
    expect(mode.rows[0].collection_mode).toBe("media_only");
    expect(mode.rows[0].country).toBe("ES");
    const x = await db.query<{ enabled: boolean }>(
      `select enabled from candidate_sources where candidate_id = '${payload.id}' and source = 'x'`,
    );
    expect(x.rows[0].enabled).toBe(false);

    let denied: { error?: string } = {};
    try {
      await asStaff(`
        select public.create_candidate(
          'Otro', 'diego-santilli', 'AR', 'full',
          null, null, null, null, null, null, null, null, null, 1.00, false
        )
      `);
    } catch (err) {
      denied = { error: String(err) };
    }
    expect(denied.error ?? "").toMatch(/ya existe un candidato con ese slug/i);
  });
});
