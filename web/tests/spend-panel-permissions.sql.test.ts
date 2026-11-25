/**
 * Prueba deploy/spend_panel.sql en PGlite. No toca la base real.
 * Solo pulso_staff puede leer el resumen de gasto; nadie más (ni miembros ni anon).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const STAFF = "aaaaaaaa-0000-0000-0000-000000000001";
const MEMBER = "bbbbbbbb-0000-0000-0000-000000000002";
const C1 = "11111111-0000-0000-0000-000000000001";
const C2 = "22222222-0000-0000-0000-000000000002";
let db: PGlite;

const FILES = [
  "schema.sql",
  "deploy/web_permissions.sql",
  "deploy/candidate_rivals.sql",
  "deploy/rival_suggestions.sql",
  "deploy/ai_visibility.sql",
  "deploy/meta_ads.sql",
  "deploy/meta_ads_classification.sql",
  "deploy/suspicious_accounts.sql",
  "deploy/crisis_agent.sql",
  "deploy/custom_topics.sql",
  "deploy/daily_brief.sql",
  "deploy/inconsistency_alerts.sql",
  "deploy/response_simulator.sql",
  "deploy/data_assistant.sql",
  "deploy/ai_visibility_cap.sql",
];

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
  for (const f of FILES) {
    try {
      await db.exec(read(f));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  await db.exec(read("deploy/spend_panel.sql"));
  await db.exec(read("deploy/spend_panel.sql")); // idempotente
  await db.exec(`
    insert into auth.users values ('${STAFF}','staff@x.com'),('${MEMBER}','m@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','pedro-sanchez','Pedro Sánchez','{sanchez}','{}');
    insert into pulso_staff (user_id, note) values ('${STAFF}', 'test');
    insert into candidate_members values ('${C1}','${MEMBER}');
    insert into daily_briefs (candidate_id, brief_date, timezone, status, headline, prompt_version, cost_usd, created_at)
      values ('${C1}', '2026-11-24', 'America/Argentina/Buenos_Aires', 'ok', 'Demo', 'v1', 0.001171, '2026-11-25T12:00:00Z'),
             ('${C2}', '2026-11-24', 'America/Argentina/Buenos_Aires', 'insufficient', 'x', 'v1', null, '2026-11-25T12:00:00Z');
    -- 02:30 UTC del 26/11 = 23:30 del 25/11 en Buenos Aires.
    insert into daily_briefs (candidate_id, brief_date, timezone, status, headline, prompt_version, cost_usd, created_at)
      values ('${C2}', '2026-11-25', 'America/Argentina/Buenos_Aires', 'ok', 'Tarde', 'v1', 0.002, '2026-11-26T02:30:00Z');
    insert into mentions (candidate_id, source, source_item_id, url, url_hash, title, published_at, classified_at, classification_model, tone, target, tone_confidence)
      values ('${C1}', 'google_news', 'a', 'https://m/a', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A', '2026-11-25T10:00:00Z', '2026-11-25T13:00:00Z', 'gpt-6-luna', 'informativo', 'candidate', 0.9),
             ('${C1}', 'google_news', 'b', 'https://m/b', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'B', '2026-11-25T10:00:00Z', '2026-11-25T13:00:00Z', 'gpt-6-luna', 'informativo', 'candidate', 0.9),
             ('${C1}', 'google_news', 'c', 'https://m/c', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'C', '2026-11-25T10:00:00Z', '2026-11-25T13:00:00Z', 'grok-bot-pm-manual', 'informativo', 'candidate', 0.9);
    insert into source_runs (candidate_id, source, run_kind, started_at, finished_at, status, items_found, items_new, cursor)
      values ('${C1}', 'x', 'manual', '2026-11-25T11:00:00Z', '2026-11-25T11:01:00Z', 'ok', 25, 20, '{"quota":{"date":"2026-11-25","posts":100,"requests":4}}'),
             ('${C1}', 'x', 'manual', '2026-11-25T13:00:00Z', '2026-11-25T13:01:00Z', 'ok', 25, 25, '{"quota":{"date":"2026-11-25","posts":150,"requests":6}}');
  `);
});

async function as(role: "anon" | "authenticated", sub: string | null, sql: string) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return { rows: (await db.query<Record<string, unknown>>(sql)).rows };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    await db.exec("reset role");
  }
}

const CALL = "select public.pulso_spend_report('2026-11-01', '2026-11-25') as r";

describe("spend_panel.sql", () => {
  it("el equipo de Active ve agregados por función, candidato y día (hora de Buenos Aires)", async () => {
    const res = await as("authenticated", STAFF, CALL);
    expect("rows" in res).toBe(true);
    const r = (res as { rows: { r: Record<string, unknown> }[] }).rows[0].r as {
      rows: { feature: string; day: string; candidate_id: string; cost_usd: number | null; items: number; basis: string }[];
      x_usage: { posts: number; requests: number; quota_date: string }[];
      x_caps: { max_posts_per_day: number }[];
    };
    const briefs = r.rows.filter((x) => x.feature === "resumen_diario");
    // Solo status ok; el de las 23:30 de Buenos Aires cae el 25.
    expect(briefs).toHaveLength(2);
    expect(briefs.find((b) => b.candidate_id === C2)?.day).toBe("2026-11-25");
    expect(Number(briefs.find((b) => b.candidate_id === C1)?.cost_usd)).toBeCloseTo(0.001171, 6);
    const cls = r.rows.find((x) => x.feature === "clasificador");
    expect(cls?.items).toBe(2); // excluye la clasificación manual
    expect(cls?.basis).toBe("sin_costo");
    expect(r.x_usage).toEqual([expect.objectContaining({ quota_date: "2026-11-25", posts: 150, requests: 6 })]);
    expect(r.x_caps.length).toBe(2);
    expect((r as unknown as { caps: { ai_visibility_budget: { daily_budget_usd: number } } }).caps.ai_visibility_budget.daily_budget_usd).toBe(1);
  });

  it("no devuelve textos ni ids de usuario", async () => {
    const res = (await as("authenticated", STAFF, CALL)) as { rows: { r: unknown }[] };
    const text = JSON.stringify(res.rows[0].r);
    expect(text).not.toContain("Demo");
    expect(text).not.toContain(STAFF);
    expect(text).not.toContain(MEMBER);
  });

  it("un miembro de candidato (no staff) no puede leerlo", async () => {
    const res = await as("authenticated", MEMBER, CALL);
    expect("error" in res && res.error).toMatch(/solo el equipo/);
  });

  it("anon no tiene permiso de ejecución", async () => {
    const res = await as("anon", null, CALL);
    expect("error" in res && res.error).toMatch(/permission denied/);
  });

  it("rechaza rangos inválidos", async () => {
    const res = await as("authenticated", STAFF, "select public.pulso_spend_report('2026-11-25', '2026-11-01')");
    expect("error" in res && res.error).toMatch(/rango/);
  });
});
