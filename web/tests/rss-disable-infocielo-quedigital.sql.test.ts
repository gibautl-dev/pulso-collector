/**
 * Prueba que el SQL saca InfoCielo y Qué Digital, deja Radio Nacional
 * y no toca a Sánchez. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role pulso_collector nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated, service_role, pulso_collector;
  `);
  await db.exec(read("schema.sql"));
  await db.exec(`
    insert into candidates (slug,name,keywords) values
      ('axel-kicillof','Axel Kicillof','{kicillof}'),
      ('milei','Javier Milei','{milei}'),
      ('pedro-sanchez','Pedro Sánchez','{sanchez}');
    update candidate_sources set settings = jsonb_build_object(
      'feeds', jsonb_build_array('https://www.clarin.com/rss/politica/', 'https://www.todoprovincial.com/feed'),
      'own_domains', jsonb_build_array()
    ) where source='rss_media' and candidate_id in (select id from candidates where slug in ('axel-kicillof','milei'));
    update candidate_sources set settings = jsonb_build_object(
      'feeds', jsonb_build_array('https://feeds.elpais.com/rss')
    ) where source='rss_media' and candidate_id = (select id from candidates where slug='pedro-sanchez');
  `);
  await db.exec(read("deploy/rss_add_feeds_nacional_infocielo_quedigital.sql"));
  await db.exec(read("deploy/rss_disable_infocielo_quedigital.sql"));
});

describe("rss_disable_infocielo_quedigital.sql", () => {
  it("saca InfoCielo y Qué Digital, deja Radio Nacional y no toca a Sánchez", async () => {
    const rows = await db.query<{ slug: string; feeds: string[] }>(`
      select c.slug, array(select jsonb_array_elements_text(cs.settings->'feeds')) as feeds
        from candidate_sources cs join candidates c on c.id=cs.candidate_id
       where cs.source='rss_media' order by c.slug
    `);
    const by = Object.fromEntries(rows.rows.map((r) => [r.slug, r.feeds]));
    for (const slug of ["axel-kicillof", "milei"] as const) {
      expect(by[slug]).toContain("https://www.clarin.com/rss/politica/");
      expect(by[slug]).toContain("https://www.todoprovincial.com/feed");
      expect(by[slug]).toContain("https://www.radionacional.com.ar/feed/");
      expect(by[slug]).not.toContain("https://www.infocielo.com/rss");
      expect(by[slug]).not.toContain("https://quedigital.com.ar/feed");
      expect(by[slug]).toHaveLength(3);
    }
    expect(by["pedro-sanchez"]).toEqual(["https://feeds.elpais.com/rss"]);
    await db.exec(read("deploy/rss_disable_infocielo_quedigital.sql"));
    const again = await db.query<{ n: number }>(`
      select jsonb_array_length(cs.settings->'feeds') as n
        from candidate_sources cs join candidates c on c.id=cs.candidate_id
       where c.slug='axel-kicillof' and cs.source='rss_media'
    `);
    expect(again.rows[0].n).toBe(3);
  });
});
