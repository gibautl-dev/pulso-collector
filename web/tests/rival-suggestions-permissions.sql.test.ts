/**
 * Prueba deploy/rival_suggestions.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const S = "cccccccc-0000-0000-0000-000000000003";
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
  await db.exec("alter table public.mentions add column if not exists relevance text;");
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(`
    create table if not exists public.ai_answers (
      id uuid primary key default gen_random_uuid(),
      candidate_id uuid,
      cost numeric,
      asked_on date
    );
    alter table public.ai_answers enable row level security;
    grant select on table public.ai_answers to authenticated;
  `);
  await db.exec(read("deploy/candidate_rivals.sql"));
  await db.exec(read("deploy/rival_suggestions.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${S}','staff@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','pedro-sanchez','Pedro Sanchez','{sanchez}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into pulso_staff (user_id, note) values ('${S}', 'test');
    insert into ai_answers (candidate_id, cost, asked_on) values ('${C1}', 0.8, '2026-11-18');
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

describe("rival_suggestions.sql", () => {
  it("el staff lee y escribe sugerencias y pendientes; un cliente no", async () => {
    expect(
      await as(
        "authenticated",
        S,
        `insert into rival_suggestion_runs (candidate_id, prompt_version, suggestions) values ('${C1}', 't', '[]'::jsonb) returning id`,
      ),
    ).toBe(1);
    expect(await as("authenticated", S, "select id from rival_suggestion_runs")).toBe(1);
    expect(await as("authenticated", A, "select id from rival_suggestion_runs")).toBe(0);
    expect(
      await as(
        "authenticated",
        A,
        `insert into pending_candidates (name, requested_for_candidate_id, requested_level, source) values ('Otro', '${C1}', 'radar', 'manual') returning id`,
      ),
    ).toBe("DENIED");
    expect(
      await as(
        "authenticated",
        S,
        `insert into pending_candidates (name, requested_for_candidate_id, requested_level, source) values ('Otro', '${C1}', 'radar', 'manual') returning id`,
      ),
    ).toBe(1);
    expect(await as("authenticated", S, "select id from pending_candidates")).toBe(1);
    expect(await as("anon", null, "select id from pending_candidates")).toBe("DENIED");
  });

  it("un pendiente no aparece en candidates, así el recolector actual no lo mide", async () => {
    const n = await as("authenticated", S, "select id from candidates");
    expect(n).toBe(2);
  });

  it("el staff puede leer el costo de En la IA", async () => {
    expect(await as("authenticated", S, "select cost from ai_answers")).toBe(1);
  });
});
