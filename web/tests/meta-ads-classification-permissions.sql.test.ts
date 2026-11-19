/**
 * Prueba deploy/meta_ads_classification.sql (SELECT para miembros, grants recortados) en PGlite.
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
const AD1 = "aaaaaaaa-1111-0000-0000-000000000001";
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
  await db.exec(read("deploy/meta_ads.sql"));
  await db.exec(read("deploy/meta_ads_classification.sql"));
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into meta_ads (id, candidate_id, ad_id, page_name, currency, spend_lower, spend_upper, fetched_on)
      values
      ('${AD1}','${C1}','111','Ratio oficial','ARS',100,499, current_date);
    insert into meta_ad_classifications (meta_ad_id, candidate_id, ad_id, stance, reason, confidence)
      values ('${AD1}','${C1}','111','en_contra','Crítica a la seguridad', 0.8);
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

describe("meta_ads_classification.sql", () => {
  it("el miembro ve solo las clasificaciones de su candidato", async () => {
    expect(await as("authenticated", A, "select stance from meta_ad_classifications")).toBe(1);
    expect(await as("authenticated", B, "select stance from meta_ad_classifications")).toBe(0);
  });

  it("authenticated no puede insertar, actualizar ni borrar, y anon no lee", async () => {
    expect(
      await as(
        "authenticated",
        A,
        `insert into meta_ad_classifications (meta_ad_id, candidate_id, ad_id, stance) values ('${AD1}','${C1}','999','a_favor') returning id`,
      ),
    ).toBe("DENIED");
    expect(await as("authenticated", A, "update meta_ad_classifications set stance='a_favor' returning id")).toBe("DENIED");
    expect(await as("authenticated", A, "delete from meta_ad_classifications returning id")).toBe("DENIED");
    expect(await as("anon", null, "select stance from meta_ad_classifications")).toBe("DENIED");
  });

  it("pulso_collector no escribe clasificaciones; pulso_classifier lee anuncios e inserta, pero no actualiza", async () => {
    expect(await as("pulso_collector", null, "select stance from meta_ad_classifications")).toBe("DENIED");
    expect(
      await as(
        "pulso_collector",
        null,
        `insert into meta_ad_classifications (meta_ad_id, candidate_id, ad_id, stance) values ('${AD1}','${C1}','888','a_favor') returning id`,
      ),
    ).toBe("DENIED");
    expect(await as("pulso_classifier", null, "select ad_id from meta_ads")).toBe(1);
    expect(await as("pulso_classifier", null, "update meta_ad_classifications set stance='a_favor' returning id")).toBe("DENIED");
    expect(await as("pulso_classifier", null, "delete from meta_ad_classifications returning id")).toBe("DENIED");
  });
});
