/**
 * Prueba deploy/data_assistant.sql en PGlite. No toca la base real.
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
  await db.exec(read("deploy/data_assistant.sql"));
  await db.exec(read("deploy/data_assistant.sql")); // idempotente
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','pedro-sanchez','Pedro Sánchez','{sanchez}','{}');
    insert into candidate_members values ('${C1}','${A}'), ('${C1}','${B}'), ('${C2}','${B}');
  `);
});

type Role = "anon" | "authenticated" | "pulso_collector" | "pulso_classifier";
async function as(role: Role, sub: string | null, sql: string): Promise<{ rows: Record<string, unknown>[] } | "DENIED"> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return { rows: (await db.query<Record<string, unknown>>(sql)).rows };
  } catch {
    return "DENIED";
  } finally {
    await db.exec("reset role");
  }
}
const count = async (role: Role, sub: string | null, sql: string) => {
  const r = await as(role, sub, sql);
  return r === "DENIED" ? r : r.rows.length;
};
const ask = (candidate: string, q = "¿qué se dijo de economía?") =>
  `insert into assistant_questions (candidate_id, question, page, prompt_version, status)
   values ('${candidate}', '${q}', 'tablero', 'data-assistant-v1', 'pending') returning id`;

describe("data_assistant.sql", () => {
  it("un miembro reserva una pregunta y la completa una sola vez", async () => {
    const res = await as("authenticated", A, ask(C1));
    expect(res).not.toBe("DENIED");
    const id = (res as { rows: { id: string }[] }).rows[0].id;
    expect(
      await count("authenticated", A, `update assistant_questions set status='ok', answer='{"text":"hola"}', cost_usd=0.0012 where id='${id}' returning id`),
    ).toBe(1);
    // Ya finalizada: no se puede reescribir.
    expect(await count("authenticated", A, `update assistant_questions set answer='{"text":"otra"}' where id='${id}' returning id`)).not.toBe(1);
    const row = await as("authenticated", A, `select status, finished_at from assistant_questions where id='${id}'`);
    expect((row as { rows: { status: string; finished_at: unknown }[] }).rows[0].status).toBe("ok");
  });

  it("no se puede preguntar por un candidato del que no es miembro", async () => {
    expect(await count("authenticated", A, ask(C2))).toBe("DENIED");
  });

  it("cada usuario ve solo sus preguntas", async () => {
    expect(await count("authenticated", B, ask(C1))).toBe(1);
    expect(await count("authenticated", A, "select id from assistant_questions")).toBe(1);
    expect(await count("authenticated", B, "select id from assistant_questions")).toBe(1);
  });

  it("user_id lo pone la base, no el cliente", async () => {
    expect(
      await count(
        "authenticated",
        A,
        `insert into assistant_questions (user_id, candidate_id, question, prompt_version) values ('${B}', '${C1}', 'hola hola', 'v') returning id`,
      ),
    ).toBe("DENIED");
  });

  it("no hay borrado ni lectura de costo/uso desde la web; anon y recolector no entran", async () => {
    expect(await count("authenticated", A, "delete from assistant_questions returning id")).toBe("DENIED");
    expect(await count("authenticated", A, "select cost_usd from assistant_questions")).toBe("DENIED");
    expect(await count("authenticated", A, "select user_id from assistant_questions")).toBe("DENIED");
    expect(await count("anon", null, "select id from assistant_questions")).toBe("DENIED");
    expect(await count("anon", null, "select * from assistant_quota()")).toBe("DENIED");
    expect(await count("pulso_collector", null, "select id from assistant_questions")).toBe("DENIED");
  });

  it("assistant_quota devuelve el cupo del usuario y el total del día", async () => {
    const r = await as("authenticated", A, "select * from assistant_quota()");
    expect(r).not.toBe("DENIED");
    const row = (r as { rows: Record<string, unknown>[] }).rows[0];
    expect(Number(row.user_last_hour)).toBe(1);
    expect(Number(row.total_today)).toBe(2);
    // Fila de B pendiente (sin costo) cuenta como el tope por pregunta.
    expect(Number(row.cost_today_usd)).toBeCloseTo(0.0112, 6);
  });

  it("el trigger corta a las 20 preguntas por hora", async () => {
    for (let i = 0; i < 18; i++) expect(await count("authenticated", A, ask(C1, `pregunta ${i}`))).toBe(1);
    expect(await count("authenticated", A, ask(C1, "una más"))).toBe(1); // 20
    expect(await count("authenticated", A, ask(C1, "la 21"))).toBe("DENIED");
  });

  it("el tope de gasto diario corta a todos", async () => {
    await db.exec(`update assistant_questions set status='ok', cost_usd=0.05 where status='pending'`);
    // 21 filas * 0.05 > USD 1: B ya no puede reservar aunque tenga cupo propio.
    expect(await count("authenticated", B, ask(C2))).toBe("DENIED");
  });
});
