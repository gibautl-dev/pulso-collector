/**
 * Prueba deploy/ai_visibility_cap_per_candidate.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const STAFF = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBER = "bbbbbbbb-0000-0000-0000-000000000002";
const OTHER = "cccccccc-0000-0000-0000-000000000003";
const K = "11111111-0000-0000-0000-000000000001";
const S = "22222222-0000-0000-0000-000000000002";
const M = "33333333-0000-0000-0000-000000000003";
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
  for (const f of ["schema.sql", "deploy/web_permissions.sql", "deploy/candidate_rivals.sql", "deploy/ai_visibility.sql", "deploy/ai_visibility_cap.sql"]) {
    await db.exec(read(f));
  }
  // Estado previo real: dos candidatos y el tope total en USD 1.
  await db.exec(`
    insert into auth.users values ('${STAFF}','s@x.com'),('${MEMBER}','m@x.com'),('${OTHER}','o@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${K}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${S}','pedro-sanchez','Pedro Sánchez','{sanchez}','{}');
    insert into pulso_staff (user_id) values ('${STAFF}');
    insert into candidate_members values ('${K}','${MEMBER}'), ('${S}','${OTHER}');
    update ai_visibility_budget set last_reached_on = current_date;
  `);
  await db.exec(read("deploy/ai_visibility_cap_per_candidate.sql"));
  await db.exec(read("deploy/ai_visibility_cap_per_candidate.sql")); // idempotente
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

describe("ai_visibility_cap_per_candidate.sql", () => {
  it("migra a USD 1 por candidato sin borrar el tope anterior", async () => {
    const r = await db.query<{ candidate_id: string; usd: string; reached: string | null }>(
      "select candidate_id, daily_budget_usd::text usd, last_reached_on::text reached from ai_visibility_candidate_budget order by candidate_id",
    );
    expect(r.rows.map((x) => [x.candidate_id, x.usd, x.reached])).toEqual([[K, "1.0000", null], [S, "1.0000", null]]);
    expect((await db.query("select * from ai_visibility_budget")).rows).toHaveLength(1);
  });

  it("un candidato nuevo recibe su tope por defecto", async () => {
    await db.exec(`insert into candidates (id,slug,name,keywords,alert_feeds) values ('${M}','milei','Javier Milei','{milei}','{}')`);
    const r = await db.query<{ usd: string }>(`select daily_budget_usd::text usd from ai_visibility_candidate_budget where candidate_id='${M}'`);
    expect(r.rows).toEqual([{ usd: "1.0000" }]);
  });

  it("staff ve y edita cada candidato por separado", async () => {
    expect(await as("authenticated", STAFF, "select candidate_id from ai_visibility_candidate_budget")).toMatchObject({ rows: [{}, {}, {}] });
    expect(await as("authenticated", STAFF, `update ai_visibility_candidate_budget set daily_budget_usd = 2 where candidate_id='${K}' returning candidate_id`)).toEqual({ rows: [{ candidate_id: K }] });
    const r = await db.query<{ candidate_id: string; usd: string }>("select candidate_id, daily_budget_usd::text usd from ai_visibility_candidate_budget order by candidate_id");
    expect(r.rows.map((x) => x.usd)).toEqual(["2.0000", "1.0000", "1.0000"]);
    await db.exec(`update ai_visibility_candidate_budget set daily_budget_usd = 1`);
  });

  it("miembros (como demo@) no ven ni editan; staff no toca last_reached_on", async () => {
    expect(await as("authenticated", MEMBER, "select * from ai_visibility_candidate_budget")).toEqual({ rows: [] });
    expect(await as("authenticated", MEMBER, "update ai_visibility_candidate_budget set daily_budget_usd = 9 returning candidate_id")).toEqual({ rows: [] });
    expect(await as("authenticated", STAFF, "update ai_visibility_candidate_budget set last_reached_on = current_date returning candidate_id")).toHaveProperty("error");
  });

  it("anon no entra", async () => {
    expect(await as("anon", null, "select * from ai_visibility_candidate_budget")).toHaveProperty("error");
    expect(await as("anon", null, `select public.ai_visibility_cap_reached_today('${K}')`)).toHaveProperty("error");
  });

  it("el job lee el tope y solo marca last_reached_on de un candidato", async () => {
    expect(await as("pulso_classifier", null, "select daily_budget_usd from ai_visibility_candidate_budget")).toMatchObject({ rows: [{}, {}, {}] });
    expect(await as("pulso_classifier", null, "update ai_visibility_candidate_budget set daily_budget_usd = 9 returning candidate_id")).toHaveProperty("error");
    expect(
      await as("pulso_classifier", null, `update ai_visibility_candidate_budget set last_reached_on = (now() at time zone 'America/Argentina/Buenos_Aires')::date where candidate_id='${S}' returning candidate_id`),
    ).toEqual({ rows: [{ candidate_id: S }] });
  });

  it("el aviso es por candidato y solo para quien lo ve", async () => {
    const q = (c: string) => `select public.ai_visibility_cap_reached_today('${c}') as reached`;
    // Sánchez alcanzó su tope; Kicillof no.
    expect(await as("authenticated", OTHER, q(S))).toEqual({ rows: [{ reached: true }] });
    expect(await as("authenticated", MEMBER, q(K))).toEqual({ rows: [{ reached: false }] });
    // Un miembro de Kicillof no puede consultar a Sánchez (no es su rival asignado).
    expect(await as("authenticated", MEMBER, q(S))).toEqual({ rows: [{ reached: null }] });
    expect(await as("authenticated", STAFF, q(S))).toEqual({ rows: [{ reached: true }] });
  });
});
