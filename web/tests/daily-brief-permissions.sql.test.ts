/**
 * Prueba deploy/daily_brief.sql en PGlite. No toca la base real.
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
  await db.exec(read("deploy/daily_brief.sql"));
  // Idempotente: se puede volver a correr.
  await db.exec(read("deploy/daily_brief.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into daily_briefs (candidate_id, brief_date, timezone, status, headline, prompt_version)
      values ('${C1}', '2026-11-24', 'America/Argentina/Buenos_Aires', 'ok', 'Demo', 'daily-brief-v1'),
             ('${C2}', '2026-11-24', 'America/Argentina/Buenos_Aires', 'insufficient', 'Otro', 'daily-brief-v1');
  `);
});

async function as(
  role: "anon" | "authenticated" | "pulso_collector" | "pulso_classifier",
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

describe("daily_brief.sql", () => {
  it("el miembro ve solo el resumen de su candidato", async () => {
    expect(await as("authenticated", A, "select id from daily_briefs")).toBe(1);
    expect(await as("authenticated", B, "select id from daily_briefs")).toBe(0);
  });

  it("la web no puede escribir ni borrar resúmenes", async () => {
    expect(await as("authenticated", A, `update daily_briefs set headline='x' returning id`)).toBe("DENIED");
    expect(await as("authenticated", A, `delete from daily_briefs returning id`)).toBe("DENIED");
    expect(
      await as(
        "authenticated",
        A,
        `insert into daily_briefs (candidate_id, brief_date, timezone, status, prompt_version)
         values ('${C1}', '2026-11-23', 'UTC', 'ok', 'v') returning id`,
      ),
    ).toBe("DENIED");
  });

  it("anon y el recolector no entran", async () => {
    expect(await as("anon", null, "select id from daily_briefs")).toBe("DENIED");
    expect(await as("pulso_collector", null, "select id from daily_briefs")).toBe("DENIED");
  });

  it("el clasificador inserta y no puede borrar", async () => {
    expect(
      await as(
        "pulso_classifier",
        null,
        `insert into daily_briefs (candidate_id, brief_date, timezone, status, prompt_version)
         values ('${C1}', '2026-11-23', 'America/Argentina/Buenos_Aires', 'insufficient', 'daily-brief-v1') returning id`,
      ),
    ).toBe(1);
    expect(await as("pulso_classifier", null, `delete from daily_briefs returning id`)).toBe("DENIED");
  });

  it("un solo resumen por candidato y día", async () => {
    expect(
      await as(
        "pulso_classifier",
        null,
        `insert into daily_briefs (candidate_id, brief_date, timezone, status, prompt_version)
         values ('${C1}', '2026-11-24', 'UTC', 'ok', 'v') returning id`,
      ),
    ).toBe("DENIED");
  });
});
