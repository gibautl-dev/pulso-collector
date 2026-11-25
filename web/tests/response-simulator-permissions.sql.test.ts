/**
 * Prueba deploy/response_simulator.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001"; // miembro de C1
const B = "bbbbbbbb-0000-0000-0000-000000000002"; // miembro de C2
const S = "cccccccc-0000-0000-0000-000000000003"; // staff, sin membresía
const C1 = "11111111-0000-0000-0000-000000000001";
const C2 = "22222222-0000-0000-0000-000000000002";
const DRAFT = "La Provincia va a seguir pagando los salarios aunque recorten fondos.";
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
  await db.exec(read("deploy/candidate_rivals.sql"));
  await db.exec(read("deploy/response_simulator.sql"));
  // Idempotente.
  await db.exec(read("deploy/response_simulator.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com'),('${S}','s@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','pedro-sanchez','Pedro Sánchez','{sanchez}','{}');
    insert into candidate_members values ('${C1}','${A}'), ('${C2}','${B}');
    insert into pulso_staff (user_id) values ('${S}');
  `);
});

async function as(
  role: "anon" | "authenticated" | "pulso_collector" | "pulso_classifier",
  sub: string | null,
  sql: string,
): Promise<{ rows: Record<string, unknown>[] } | { error: string }> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    const res = await db.query<Record<string, unknown>>(sql);
    return { rows: res.rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    await db.exec("reset role");
  }
}

const start = (cand: string, reserve = 0.002) =>
  `select public.start_response_simulation('${cand}', '${DRAFT}', ${reserve}) as id`;

async function setLimits(sql: string) {
  await db.exec(`reset role; update response_simulator_settings set ${sql};`);
}

async function clearSims() {
  await db.exec("reset role; delete from response_simulations;");
}

describe("response_simulator.sql", () => {
  it("el miembro inicia una simulación de su candidato y solo él la ve", async () => {
    await clearSims();
    const r = await as("authenticated", A, start(C1));
    expect("rows" in r && r.rows.length).toBe(1);
    const mine = await as("authenticated", A, "select id, user_id, status, reserved_usd from response_simulations");
    expect("rows" in mine && mine.rows.length).toBe(1);
    expect("rows" in mine && mine.rows[0].status).toBe("running");
    const other = await as("authenticated", B, "select id from response_simulations");
    expect("rows" in other && other.rows.length).toBe(0);
    // Staff no ve borradores ajenos.
    const staff = await as("authenticated", S, "select id from response_simulations");
    expect("rows" in staff && staff.rows.length).toBe(0);
  });

  it("no se puede simular sobre un candidato ajeno; staff sí", async () => {
    await clearSims();
    const r = await as("authenticated", B, start(C1));
    expect("error" in r && r.error).toMatch(/pulso:forbidden/);
    const s = await as("authenticated", S, start(C1));
    expect("rows" in s && s.rows.length).toBe(1);
  });

  it("la app no escribe directo en la tabla", async () => {
    await clearSims();
    for (const sql of [
      `insert into response_simulations (candidate_id,user_id,draft,reserved_usd) values ('${C1}','${A}','${DRAFT}',0) returning id`,
      `update response_simulations set cost_usd = 0 returning id`,
      `delete from response_simulations returning id`,
    ]) {
      const r = await as("authenticated", A, sql);
      expect("error" in r || ("rows" in r && r.rows.length === 0)).toBe(true);
    }
  });

  it("anon y los roles del cron no entran", async () => {
    expect("error" in (await as("anon", null, "select id from response_simulations"))).toBe(true);
    expect("error" in (await as("anon", null, start(C1)))).toBe(true);
    expect("error" in (await as("pulso_collector", null, "select id from response_simulations"))).toBe(true);
    expect("error" in (await as("pulso_classifier", null, "select id from response_simulations"))).toBe(true);
  });

  it("corta por ráfaga del mismo usuario", async () => {
    await clearSims();
    await setLimits("per_user_window = 2, window_minutes = 10");
    expect("rows" in (await as("authenticated", A, start(C1)))).toBe(true);
    expect("rows" in (await as("authenticated", A, start(C1)))).toBe(true);
    const third = await as("authenticated", A, start(C1));
    expect("error" in third && third.error).toMatch(/pulso:rate_limited/);
    // Otro usuario no se ve afectado.
    expect("rows" in (await as("authenticated", B, start(C2)))).toBe(true);
    await setLimits("per_user_window = 5");
  });

  it("corta por máximo diario por usuario", async () => {
    await clearSims();
    await setLimits("per_user_window = 100, per_user_daily = 1");
    expect("rows" in (await as("authenticated", A, start(C1)))).toBe(true);
    const r = await as("authenticated", A, start(C1));
    expect("error" in r && r.error).toMatch(/pulso:user_daily_limit/);
    await setLimits("per_user_window = 5, per_user_daily = 30");
  });

  it("corta por presupuesto diario global y por tope por pedido", async () => {
    await clearSims();
    await setLimits("daily_budget_usd = 0.005, max_request_usd = 0.003, per_user_window = 100");
    const tooBig = await as("authenticated", A, start(C1, 0.004));
    expect("error" in tooBig && tooBig.error).toMatch(/pulso:request_too_expensive/);
    expect("rows" in (await as("authenticated", A, start(C1, 0.002)))).toBe(true);
    expect("rows" in (await as("authenticated", B, start(C2, 0.002)))).toBe(true);
    const over = await as("authenticated", A, start(C1, 0.002));
    expect("error" in over && over.error).toMatch(/pulso:daily_budget/);
    await setLimits("daily_budget_usd = 1, max_request_usd = 0.01, per_user_window = 5");
  });

  it("reserva al menos un décimo del tope aunque se pida menos", async () => {
    await clearSims();
    const r = await as("authenticated", A, start(C1, 0));
    expect("rows" in r).toBe(true);
    const row = await as("authenticated", A, "select reserved_usd from response_simulations");
    expect("rows" in row && Number(row.rows[0].reserved_usd)).toBeCloseTo(0.001, 6);
  });

  it("finish solo sobre una simulación propia en curso, una vez", async () => {
    await clearSims();
    const r = await as("authenticated", A, start(C1));
    const id = "rows" in r ? String(r.rows[0].id) : "";
    const finish = (status: string) =>
      `select public.finish_response_simulation('${id}', '${status}', '{"risk_score": 40}'::jsonb, '{}'::jsonb, 'gpt-6-luna', 'v1', 0.0012, '{}'::jsonb, null)`;
    const other = await as("authenticated", B, finish("ok"));
    expect("error" in other && other.error).toMatch(/pulso:not_found/);
    expect("rows" in (await as("authenticated", A, finish("ok")))).toBe(true);
    const again = await as("authenticated", A, finish("ok"));
    expect("error" in again && again.error).toMatch(/pulso:not_found/);
    const row = await as("authenticated", A, "select status, cost_usd, output from response_simulations");
    expect("rows" in row && row.rows[0].status).toBe("ok");
    expect("rows" in row && Number(row.rows[0].cost_usd)).toBeCloseTo(0.0012, 6);
  });

  it("solo staff cambia los topes", async () => {
    const member = await as("authenticated", A, "update response_simulator_settings set daily_budget_usd = 100 returning id");
    expect("rows" in member && member.rows.length).toBe(0);
    const staff = await as("authenticated", S, "update response_simulator_settings set daily_budget_usd = 2 returning id");
    expect("rows" in staff && staff.rows.length).toBe(1);
    const read = await as("authenticated", A, "select daily_budget_usd from response_simulator_settings");
    expect("rows" in read && Number(read.rows[0].daily_budget_usd)).toBe(2);
  });

  it("pausado: no arranca ninguna simulación", async () => {
    await clearSims();
    await setLimits("enabled = false");
    const r = await as("authenticated", A, start(C1));
    expect("error" in r && r.error).toMatch(/pulso:disabled/);
    await setLimits("enabled = true");
  });
});
