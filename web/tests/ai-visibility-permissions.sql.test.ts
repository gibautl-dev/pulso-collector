/**
 * Prueba deploy/ai_visibility.sql (grants recortados a SELECT) en PGlite.
 * No toca la base real.
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
  await db.exec(read("deploy/ai_visibility.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into ai_answers (candidate_id, provider, model, prompt_key, prompt, answer, balance, asked_at, asked_on)
    values
      ('${C1}','openai','chat-latest','quien_es','¿Quién es?','Texto',10, timestamptz '2026-11-18 13:50:00-03', '2026-11-18'),
      ('${C2}','openai','chat-latest','quien_es','¿Quién es?','Otro',-5, timestamptz '2026-11-18 13:50:00-03', '2026-11-18');
  `);
});

async function as(role: "anon" | "authenticated" | "pulso_classifier" | "pulso_collector", sub: string | null, sql: string): Promise<number | "DENIED"> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql)).rows.length;
  } catch {
    return "DENIED";
  } finally {
    await db.exec("reset role");
  }
}

describe("ai_visibility.sql", () => {
  it("el miembro ve solo las respuestas de su candidato", async () => {
    expect(await as("authenticated", A, "select prompt_key from ai_answers")).toBe(1);
    expect(await as("authenticated", B, "select prompt_key from ai_answers")).toBe(0);
  });

  it("authenticated no puede insertar ni borrar, y anon no lee", async () => {
    expect(
      await as(
        "authenticated",
        A,
        `insert into ai_answers (candidate_id, provider, model, prompt_key, prompt, answer, asked_at, asked_on)
         values ('${C1}','openai','chat-latest','x','p','a', now(), current_date) returning id`,
      ),
    ).toBe("DENIED");
    expect(await as("authenticated", A, `delete from ai_answers returning id`)).toBe("DENIED");
    expect(await as("anon", null, "select prompt_key from ai_answers")).toBe("DENIED");
  });

  it("pulso_classifier puede insertar y pulso_collector no", async () => {
    expect(
      await as(
        "pulso_classifier",
        null,
        `insert into ai_answers (candidate_id, provider, model, prompt_key, prompt, answer, asked_at, asked_on)
         values ('${C1}','openai','chat-latest','economia','p','a', now(), current_date) returning id`,
      ),
    ).toBe(1);
    expect(
      await as(
        "pulso_collector",
        null,
        `insert into ai_answers (candidate_id, provider, model, prompt_key, prompt, answer, asked_at, asked_on)
         values ('${C1}','openai','chat-latest','salud','p','a', now(), current_date) returning id`,
      ),
    ).toBe("DENIED");
  });
});
