/**
 * Prueba deploy/web_permissions.sql en un Postgres embebido (PGlite) que
 * simula lo mínimo de Supabase: roles anon/authenticated/service_role,
 * auth.users y auth.uid(). Aplica schema.sql + la columna relevance + el
 * script, y verifica qué puede leer cada usuario. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001"; // miembro de Kicillof
const B = "bbbbbbbb-0000-0000-0000-000000000002"; // autenticado sin membresía
const C1 = "11111111-0000-0000-0000-000000000001";
const C2 = "22222222-0000-0000-0000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated, service_role;
    -- Supabase da grants por defecto en tablas nuevas; el script debe revocarlos.
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(read("schema.sql"));
  await db.exec("alter table public.mentions add column relevance text;");
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{https://privado}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into mentions (candidate_id,source,url,url_hash,title,published_at) values
      ('${C1}','google_news','https://a.com/1',repeat('a',64),'m1',now()),
      ('${C2}','google_news','https://b.com/1',repeat('b',64),'m2',now());
    insert into source_runs (candidate_id,source,status,finished_at,cursor) values
      ('${C1}','rss_media','ok',now()+interval '1 s','{"x":1}'),
      ('${C2}','rss_media','ok',now()+interval '1 s','{}');
    insert into candidate_members values ('${C1}','${A}');
  `);
});

async function as(role: "anon" | "authenticated", sub: string | null, sql: string): Promise<number | "DENIED"> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql)).rows.length;
  } catch {
    return "DENIED";
  } finally {
    await db.exec("reset role");
  }
}

describe("web_permissions.sql", () => {
  it.each([
    ["select id,slug,name from candidates", 1],
    ["select keywords from candidates", "DENIED"],
    ["select alert_feeds from candidates", "DENIED"],
    ["select * from mentions", 1],
    ["select id,label from topics", 0],
    ["select id,status,error from source_runs", 1],
    ["select cursor from source_runs", "DENIED"],
    ["select source,enabled,last_success_at,coverage_status from candidate_sources", 10],
    ["select settings from candidate_sources", "DENIED"],
    ["select * from candidate_members", 1],
    ["select * from daily_usage", "DENIED"],
    ["select * from source_catalog", "DENIED"],
    ["update mentions set tone='critica' returning id", "DENIED"],
    ["delete from mentions returning id", "DENIED"],
    [`insert into candidate_members values ('${C2}','${A}') returning 1`, "DENIED"],
  ] as const)("miembro: %s → %s", async (sql, expected) => {
    expect(await as("authenticated", A, sql)).toBe(expected);
  });

  it.each([
    "select id,slug,name from candidates",
    "select * from mentions",
    "select id from source_runs",
    "select * from candidate_members",
  ])("autenticado sin membresía no ve filas: %s", async (sql) => {
    expect(await as("authenticated", B, sql)).toBe(0);
  });

  it.each(["select * from mentions", "select id from candidates", "select * from candidate_members", "select * from ai_outputs"])(
    "anon sin acceso: %s",
    async (sql) => {
      expect(await as("anon", null, sql)).toBe("DENIED");
    },
  );

  it("es idempotente", async () => {
    await expect(db.exec(read("deploy/web_permissions.sql"))).resolves.toBeDefined();
  });
});
