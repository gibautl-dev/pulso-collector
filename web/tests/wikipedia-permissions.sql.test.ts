/**
 * Prueba deploy/wikipedia_pageviews.sql (SELECT para miembros, grants recortados) en PGlite.
 * No toca la base real ni cambia el esquema.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C1 = "11111111-0000-0000-0000-000000000001";
const C2 = "22222222-0000-0000-0000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role pulso_collector nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, pulso_collector;
    grant usage on schema public to anon, authenticated, service_role, pulso_collector;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(read("schema.sql"));
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(read("deploy/wikipedia_pageviews.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into wikipedia_pageviews (candidate_id, project, article, day, views)
      values
      ('${C1}','es.wikipedia','Axel_Kicillof','2026-11-24',1100),
      ('${C2}','es.wikipedia','Otro','2026-11-24',50);
    insert into wikipedia_pageview_settings (candidate_id, enabled, project, article)
      values ('${C1}', true, 'es.wikipedia', 'Axel_Kicillof'),
             ('${C2}', true, 'es.wikipedia', 'Otro');
  `);
});

async function as(
  role: "anon" | "authenticated" | "pulso_collector",
  sub: string | null,
  sql: string,
): Promise<number | "DENIED"> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql)).rows.length;
  } catch {
    return "DENIED";
  } finally {
    await db.exec("reset role");
  }
}

describe("wikipedia_pageviews.sql", () => {
  it("el miembro ve solo las visitas de su candidato", async () => {
    expect(await as("authenticated", A, "select views from wikipedia_pageviews")).toBe(1);
    expect(await as("authenticated", A, "select article from wikipedia_pageview_settings")).toBe(1);
    expect(await as("authenticated", B, "select views from wikipedia_pageviews")).toBe(0);
  });

  it("authenticated no puede insertar ni borrar, y anon no lee", async () => {
    expect(
      await as(
        "authenticated",
        A,
        `insert into wikipedia_pageviews (candidate_id, project, article, day, views) values ('${C1}','es.wikipedia','Axel_Kicillof','2026-11-23',1) returning id`,
      ),
    ).toBe("DENIED");
    expect(await as("authenticated", A, "delete from wikipedia_pageviews returning id")).toBe("DENIED");
    expect(await as("anon", null, "select views from wikipedia_pageviews")).toBe("DENIED");
  });

  it("el recolector puede insertar y el seed no pisa un artículo ya cargado", async () => {
    expect(
      await as(
        "pulso_collector",
        null,
        `insert into wikipedia_pageviews (candidate_id, project, article, day, views) values ('${C1}','es.wikipedia','Axel_Kicillof','2026-11-22',900) returning id`,
      ),
    ).toBe(1);
    const res = await db.query(`select article from wikipedia_pageview_settings where candidate_id='${C1}'`);
    expect((res.rows[0] as { article: string }).article).toBe("Axel_Kicillof");
  });
});
