/**
 * Prueba deploy/candidate_rivals.sql en PGlite. No toca la base real.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const S = "cccccccc-0000-0000-0000-000000000003";
const C1 = "11111111-0000-0000-0000-000000000001";
const C2 = "22222222-0000-0000-0000-000000000002";
const MEDIA = "aaaaaaaa-0000-4000-8000-000000000031";
const XPOST = "aaaaaaaa-0000-4000-8000-000000000032";
const HASH1 = "ab".repeat(32);
const HASH2 = "cd".repeat(32);
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
    alter table public.suspicious_accounts enable row level security;
    grant select on table public.suspicious_accounts to authenticated;
    create table if not exists public.meta_ads (
      id uuid primary key, candidate_id uuid
    );
    alter table public.meta_ads enable row level security;
    grant select on table public.meta_ads to authenticated;
    create table if not exists public.meta_ad_classifications (
      id uuid primary key, candidate_id uuid
    );
    alter table public.meta_ad_classifications enable row level security;
    grant select on table public.meta_ad_classifications to authenticated;
    create table if not exists public.ai_answers (
      id uuid primary key, candidate_id uuid
    );
    alter table public.ai_answers enable row level security;
    grant select on table public.ai_answers to authenticated;
  `);
  await db.exec(read("deploy/candidate_rivals.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com'),('${S}','staff@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','pedro-sanchez','Pedro Sanchez','{sanchez}','{}');
    insert into candidate_members values ('${C1}','${A}'), ('${C2}','${B}');
    insert into pulso_staff (user_id, note) values ('${S}', 'fixture test');
    insert into mentions (
      id, candidate_id, source, url, url_hash, title, published_at, collected_at, tone, target, tone_confidence, classified_at
    ) values
      ('${MEDIA}','${C2}','google_news','https://medio.example/1','${HASH1}','Media C2', now(), now(), 'informativo','candidate',0.9, now()),
      ('${XPOST}','${C2}','x','https://x.com/1','${HASH2}','Post C2', now(), now(), 'informativo','candidate',0.9, now());
    insert into meta_ads (id, candidate_id) values ('${MEDIA}', '${C2}');
    insert into ai_answers (id, candidate_id) values ('${MEDIA}', '${C2}');
    insert into suspicious_accounts (id, candidate_id) values ('${MEDIA}', '${C2}');
    insert into candidate_rivals (candidate_id, rival_id, level) values ('${C1}', '${C2}', 'radar');
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

describe("candidate_rivals.sql", () => {
  it("el cliente ve solo los rivales de su candidato", async () => {
    expect(await as("authenticated", A, "select rival_id from candidate_rivals")).toBe(1);
    expect(await as("authenticated", B, "select rival_id from candidate_rivals")).toBe(0);
    expect(await as("authenticated", S, "select rival_id from candidate_rivals")).toBe(1);
  });

  it("en radar el miembro de A lee medios de B, no posts de X ni anuncios ni IA", async () => {
    expect(await as("authenticated", A, `select id from mentions where id='${MEDIA}'`)).toBe(1);
    expect(await as("authenticated", A, `select id from mentions where id='${XPOST}'`)).toBe(0);
    expect(await as("authenticated", A, "select id from meta_ads")).toBe(0);
    expect(await as("authenticated", A, "select id from ai_answers")).toBe(0);
    expect(await as("authenticated", A, "select id from suspicious_accounts")).toBe(0);
    expect(await as("authenticated", A, `select slug from candidates where id='${C2}'`)).toBe(1);
  });

  it("el miembro de B no ve los datos de A por esta vía, y no escribe rivales", async () => {
    expect(await as("authenticated", B, `select id from mentions where candidate_id='${C1}'`)).toBe(0);
    expect(
      await as(
        "authenticated",
        B,
        `insert into candidate_rivals (candidate_id, rival_id, level) values ('${C2}', '${C1}', 'completo') returning rival_id`,
      ),
    ).toBe("DENIED");
    expect(await as("anon", null, "select rival_id from candidate_rivals")).toBe("DENIED");
  });

  it("el staff puede cambiar el nivel y entonces A lee lo que permite ese nivel", async () => {
    expect(
      await as(
        "authenticated",
        S,
        `update candidate_rivals set level='completo' where candidate_id='${C1}' and rival_id='${C2}' returning rival_id`,
      ),
    ).toBe(1);
    expect(await as("authenticated", A, `select id from mentions where id='${XPOST}'`)).toBe(1);
    expect(await as("authenticated", A, "select id from meta_ads")).toBe(1);
    expect(await as("authenticated", A, "select id from ai_answers")).toBe(1);
    expect(await as("authenticated", A, "select id from suspicious_accounts")).toBe(1);
  });

  it("en comparativo no abre IA ni sospechosas", async () => {
    expect(
      await as(
        "authenticated",
        S,
        `update candidate_rivals set level='comparativo' where candidate_id='${C1}' and rival_id='${C2}' returning rival_id`,
      ),
    ).toBe(1);
    expect(await as("authenticated", A, `select id from mentions where id='${XPOST}'`)).toBe(1);
    expect(await as("authenticated", A, "select id from meta_ads")).toBe(1);
    expect(await as("authenticated", A, "select id from ai_answers")).toBe(0);
    expect(await as("authenticated", A, "select id from suspicious_accounts")).toBe(0);
  });
});
