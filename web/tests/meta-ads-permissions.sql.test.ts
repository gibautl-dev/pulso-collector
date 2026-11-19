/**
 * Prueba deploy/meta_ads.sql (SELECT para miembros, grants recortados) en PGlite.
 * No toca la base real ni cambia el esquema.
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
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, pulso_collector;
    grant usage on schema public to anon, authenticated, service_role, pulso_collector;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(read("schema.sql"));
  await db.exec(read("deploy/web_permissions.sql"));
  await db.exec(read("deploy/meta_ads.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into meta_ads (candidate_id, ad_id, page_name, currency, spend_lower, spend_upper, fetched_on)
      values
      ('${C1}','111','Ratio oficial','ARS',100,499, current_date),
      ('${C2}','222','Otra','USD',100,499, current_date);
    insert into meta_ads_settings (candidate_id, enabled) values ('${C1}', true), ('${C2}', true);
  `);
});

async function as(
  role: "anon" | "authenticated" | "pulso_collector",
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

describe("meta_ads.sql", () => {
  it("el miembro ve solo los anuncios de su candidato", async () => {
    expect(await as("authenticated", A, "select ad_id from meta_ads")).toBe(1);
    expect(await as("authenticated", A, "select candidate_id from meta_ads_settings")).toBe(1);
    expect(await as("authenticated", B, "select ad_id from meta_ads")).toBe(0);
  });

  it("authenticated no puede insertar, actualizar ni borrar, y anon no lee", async () => {
    expect(
      await as(
        "authenticated",
        A,
        `insert into meta_ads (candidate_id, ad_id, fetched_on) values ('${C1}','333', current_date) returning id`,
      ),
    ).toBe("DENIED");
    expect(await as("authenticated", A, "update meta_ads set page_name='x' returning id")).toBe("DENIED");
    expect(await as("authenticated", A, "delete from meta_ads returning id")).toBe("DENIED");
    expect(await as("anon", null, "select ad_id from meta_ads")).toBe("DENIED");
    expect(await as("anon", null, "select candidate_id from meta_ads_settings")).toBe("DENIED");
  });

  it("pulso_collector puede insertar y authenticated no ve columnas privilegiadas de más", async () => {
    expect(
      await as(
        "pulso_collector",
        null,
        `insert into meta_ads (candidate_id, ad_id, fetched_on) values ('${C1}','444', current_date) returning id`,
      ),
    ).toBe(1);
    expect(await as("authenticated", A, "select ad_id from meta_ads")).toBe(2);
  });
});
