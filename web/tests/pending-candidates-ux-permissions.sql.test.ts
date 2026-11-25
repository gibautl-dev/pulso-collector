/**
 * Prueba deploy/pending_candidates_ux.sql en PGlite. No toca la base real.
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
  await db.exec(read("deploy/candidate_rivals.sql"));
  await db.exec(read("deploy/rival_suggestions.sql"));
  await db.exec(read("deploy/pending_candidates_ux.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${S}','staff@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','pedro-sanchez','Pedro Sanchez','{sanchez}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into pulso_staff (user_id, note) values ('${S}', 'test');
  `);
});

async function as(
  role: "anon" | "authenticated" | "pulso_collector" | "pulso_classifier",
  sub: string | null,
  sql: string,
): Promise<number | "DENIED" | "CONFLICT"> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql)).rows.length;
  } catch (err) {
    const msg = String(err);
    if (/unique|duplicate/i.test(msg)) return "CONFLICT";
    return "DENIED";
  } finally {
    await db.exec("reset role");
  }
}

describe("pending_candidates_ux.sql", () => {
  it("normaliza acentos y bloquea un duplicado del mismo candidato", async () => {
    expect(
      await as(
        "authenticated",
        S,
        `insert into pending_candidates (name, requested_for_candidate_id, requested_level, source)
         values ('Milei', '${C1}', 'comparativo', 'manual') returning id`,
      ),
    ).toBe(1);
    expect(
      await as(
        "authenticated",
        S,
        `insert into pending_candidates (name, requested_for_candidate_id, requested_level, source)
         values ('mileí', '${C1}', 'comparativo', 'manual') returning id`,
      ),
    ).toBe("CONFLICT");
    // Otro candidato sí puede pedir el mismo nombre.
    expect(
      await as(
        "authenticated",
        S,
        `insert into pending_candidates (name, requested_for_candidate_id, requested_level, source)
         values ('Milei', '${C2}', 'radar', 'manual') returning id`,
      ),
    ).toBe(1);
  });

  it("el staff aprueba y el cliente no actualiza", async () => {
    expect(
      await as(
        "authenticated",
        S,
        `update pending_candidates set status = 'aprobado', approved_at = now(), approved_by = '${S}'
         where name = 'Milei' and requested_for_candidate_id = '${C1}' returning id`,
      ),
    ).toBe(1);
    expect(
      await as(
        "authenticated",
        A,
        `update pending_candidates set status = 'borrado' where requested_for_candidate_id = '${C1}' returning id`,
      ),
    ).toBe(0);
  });

  it("después de borrar se puede volver a pedir el nombre", async () => {
    expect(
      await as(
        "authenticated",
        S,
        `update pending_candidates set status = 'borrado'
         where name = 'Milei' and requested_for_candidate_id = '${C2}' returning id`,
      ),
    ).toBe(1);
    expect(
      await as(
        "authenticated",
        S,
        `insert into pending_candidates (name, requested_for_candidate_id, requested_level, source)
         values ('Milei', '${C2}', 'comparativo', 'manual') returning id`,
      ),
    ).toBe(1);
  });
});
