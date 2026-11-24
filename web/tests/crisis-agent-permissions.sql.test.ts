/**
 * Prueba deploy/crisis_agent.sql en PGlite. No toca la base real.
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
const ALERT = "aaaaaaaa-0000-4000-8000-000000000021";
const BRIEF = "aaaaaaaa-0000-4000-8000-000000000022";
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
  await db.exec(`
    create table if not exists public.suspicious_accounts (
      id uuid primary key, candidate_id uuid
    );
    create table if not exists public.meta_ads (
      id uuid primary key, candidate_id uuid
    );
    create table if not exists public.meta_ad_classifications (
      id uuid primary key, candidate_id uuid
    );
    create table if not exists public.ai_answers (
      id uuid primary key, candidate_id uuid
    );
  `);
  await db.exec(read("deploy/crisis_agent.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into crisis_agent_settings (candidate_id, enabled, max_cost_usd) values
      ('${C1}', true, 0.50),
      ('${C2}', false, 0.50);
    insert into crisis_alerts (
      id, candidate_id, trigger_type, trigger_key, cluster_label,
      window_start, window_end, severity, metrics, status
    ) values (
      '${ALERT}', '${C1}', 'rising_topic', 'rising_topic:demo',
      'Control laboral', now() - interval '2 days', now(), 'medio_alto',
      '{"media_count": 4}'::jsonb, 'new'
    );
    insert into crisis_briefs (
      id, alert_id, candidate_id, prompt_version, model, title, risk_level, output
    ) values (
      '${BRIEF}', '${ALERT}', '${C1}', 'crisis-v1', 'gpt-6-luna', 'Demo', 'medio_alto',
      '{"title":"Demo"}'::jsonb
    );
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

describe("crisis_agent.sql", () => {
  it("el miembro ve las alertas y el brief de su candidato", async () => {
    expect(await as("authenticated", A, "select id from crisis_alerts")).toBe(1);
    expect(await as("authenticated", A, "select id from crisis_briefs")).toBe(1);
    expect(await as("authenticated", A, "select candidate_id from crisis_agent_settings")).toBe(1);
  });

  it("puede cambiar solo el estado, no la gravedad ni las métricas", async () => {
    expect(
      await as(
        "authenticated",
        A,
        `update crisis_alerts set status='approved', status_note='ok', status_updated_at=now(), status_updated_by='${A}' where id='${ALERT}' returning id`,
      ),
    ).toBe(1);
    expect(
      await as("authenticated", A, `update crisis_alerts set severity='alto' where id='${ALERT}' returning id`),
    ).toBe("DENIED");
    expect(
      await as(
        "authenticated",
        A,
        `update crisis_alerts set metrics='{"media_count":99}'::jsonb where id='${ALERT}' returning id`,
      ),
    ).toBe("DENIED");
  });

  it("no ve ni toca al otro candidato, y anon no entra", async () => {
    expect(await as("authenticated", B, "select id from crisis_alerts")).toBe(0);
    expect(await as("anon", null, "select id from crisis_alerts")).toBe("DENIED");
    expect(await as("pulso_collector", null, "select id from crisis_alerts")).toBe("DENIED");
  });

  it("el clasificador puede insertar una alerta nueva", async () => {
    expect(
      await as(
        "pulso_classifier",
        null,
        `insert into crisis_alerts (
           candidate_id, trigger_type, trigger_key, cluster_label,
           window_start, window_end, severity, metrics, status
         ) values (
           '${C1}', 'negative_spike', 'negative_spike:2026-11-23', 'Pico',
           now() - interval '1 day', now(), 'medio', '{}'::jsonb, 'new'
         ) returning id`,
      ),
    ).toBe(1);
  });
});
