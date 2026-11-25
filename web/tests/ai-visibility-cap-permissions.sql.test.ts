/**
 * Prueba deploy/ai_visibility_cap.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const STAFF = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBER = "bbbbbbbb-0000-0000-0000-000000000002";
const C1 = "11111111-0000-0000-0000-000000000001";
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
  for (const f of ["schema.sql", "deploy/web_permissions.sql", "deploy/candidate_rivals.sql", "deploy/ai_visibility.sql"]) {
    await db.exec(read(f));
  }
  await db.exec(read("deploy/ai_visibility_cap.sql"));
  await db.exec(read("deploy/ai_visibility_cap.sql")); // idempotente
  await db.exec(`
    insert into auth.users values ('${STAFF}','s@x.com'),('${MEMBER}','m@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}');
    insert into pulso_staff (user_id) values ('${STAFF}');
    insert into candidate_members values ('${C1}','${MEMBER}');
  `);
});

type Role = "anon" | "authenticated" | "pulso_classifier";
async function as(role: Role, sub: string | null, sql: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return { rows: (await db.query<Record<string, unknown>>(sql)).rows };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await db.exec("reset role");
  }
}

describe("ai_visibility_cap.sql", () => {
  it("arranca con USD 1 por día y una sola fila", async () => {
    const r = await db.query<{ n: number; usd: string }>("select count(*)::int n, max(daily_budget_usd)::text usd from ai_visibility_budget");
    expect(r.rows[0]).toEqual({ n: 1, usd: "1.0000" });
  });

  it("el equipo de Active lo ve y lo edita", async () => {
    expect(await as("authenticated", STAFF, "select daily_budget_usd from ai_visibility_budget")).toMatchObject({ rows: [{}] });
    const up = await as("authenticated", STAFF, "update ai_visibility_budget set daily_budget_usd = 2 where id returning id");
    expect(up).toMatchObject({ rows: [{}] });
    await db.exec("update ai_visibility_budget set daily_budget_usd = 1");
  });

  it("un miembro no lo ve ni lo cambia; tampoco puede tocar last_reached_on", async () => {
    expect(await as("authenticated", MEMBER, "select * from ai_visibility_budget")).toEqual({ rows: [] });
    expect(await as("authenticated", MEMBER, "update ai_visibility_budget set daily_budget_usd = 9 where id returning id")).toEqual({ rows: [] });
    expect(await as("authenticated", STAFF, "update ai_visibility_budget set last_reached_on = current_date returning id")).toHaveProperty("error");
  });

  it("anon no entra", async () => {
    expect(await as("anon", null, "select * from ai_visibility_budget")).toHaveProperty("error");
    expect(await as("anon", null, "select public.ai_visibility_cap_reached_today()")).toHaveProperty("error");
  });

  it("el job lee el tope y solo marca last_reached_on", async () => {
    expect(await as("pulso_classifier", null, "select daily_budget_usd from ai_visibility_budget")).toMatchObject({ rows: [{}] });
    expect(await as("pulso_classifier", null, "update ai_visibility_budget set daily_budget_usd = 9 returning id")).toHaveProperty("error");
    expect(
      await as("pulso_classifier", null, "update ai_visibility_budget set last_reached_on = (now() at time zone 'America/Argentina/Buenos_Aires')::date returning id"),
    ).toMatchObject({ rows: [{}] });
  });

  it("la web del cliente solo recibe un booleano", async () => {
    const r = await as("authenticated", MEMBER, "select public.ai_visibility_cap_reached_today() as reached");
    expect(r).toEqual({ rows: [{ reached: true }] });
    await db.exec("update ai_visibility_budget set last_reached_on = current_date - 3");
    expect(await as("authenticated", MEMBER, "select public.ai_visibility_cap_reached_today() as reached")).toEqual({ rows: [{ reached: false }] });
  });
});
