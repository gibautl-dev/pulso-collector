/**
 * Prueba deploy/suspicious_accounts.sql (con el ajuste de grants) en PGlite.
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
const S1 = "aaaaaaaa-0000-4000-8000-000000000011";
const S2 = "bbbbbbbb-0000-4000-8000-000000000012";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role pulso_collector nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, pulso_collector;
    grant usage on schema public to anon, authenticated, service_role, pulso_collector;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(read("schema.sql"));
  await db.exec("alter table public.mentions add column relevance text;");
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(read("deploy/suspicious_accounts.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into suspicious_accounts
      (id, candidate_id, platform, account_key, handle, display_name, profile_url, score, signals, status)
      values
      ('${S1}','${C1}','x','demo_cuenta','demo_cuenta','Ejemplo','https://x.com/demo_cuenta',25,'[]','pending'),
      ('${S2}','${C2}','x','otra','otra','Otra','https://x.com/otra',40,'[]','pending');
  `);
});

async function as(role: "anon" | "authenticated", sub: string | null, sql: string): Promise<number | "DENIED" | "GUARD"> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
  try {
    return (await db.query(sql)).rows.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("solo se puede actualizar el estado de revisión")) return "GUARD";
    return "DENIED";
  } finally {
    await db.exec("reset role");
  }
}

describe("suspicious_accounts.sql", () => {
  it("el miembro ve solo las cuentas de su candidato", async () => {
    expect(await as("authenticated", A, "select account_key from suspicious_accounts")).toBe(1);
    expect(await as("authenticated", A, "select account_key from suspicious_accounts_web")).toBe(1);
  });

  it("puede marcar el estado y no el puntaje", async () => {
    expect(
      await as(
        "authenticated",
        A,
        `update suspicious_accounts set status='discarded', status_note='falso positivo' where id='${S1}' returning id`,
      ),
    ).toBe(1);
    expect(
      await as("authenticated", A, `update suspicious_accounts set score=99 where id='${S1}' returning id`),
    ).toBe("DENIED");
  });

  it("sin membresía no ve filas; anon no tiene acceso", async () => {
    expect(await as("authenticated", B, "select * from suspicious_accounts")).toBe(0);
    expect(await as("anon", null, "select * from suspicious_accounts")).toBe("DENIED");
    expect(await as("anon", null, "select * from suspicious_accounts_web")).toBe("DENIED");
  });
});
