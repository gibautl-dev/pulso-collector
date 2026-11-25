/**
 * Prueba deploy/inconsistency_alerts.sql en PGlite. No toca la base real.
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
const LATER = `'{"id":"m1","kind":"flag","text":"Da marcha atrás","url":"https://x.org/1","published_at":"2026-11-12T10:00:00Z","source":"google_news","outlet":"Medio"}'`;
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
  await db.exec(read("deploy/inconsistency_alerts.sql"));
  await db.exec(read("deploy/inconsistency_alerts.sql")); // idempotente
  await db.exec(`
    insert into auth.users values ('${A}','a@x.com'),('${B}','b@x.com');
    insert into candidates (id,slug,name,keywords,alert_feeds) values
      ('${C1}','axel-kicillof','Axel Kicillof','{kicillof}','{}'),
      ('${C2}','otro','Otro','{otro}','{}');
    insert into candidate_members values ('${C1}','${A}');
    insert into inconsistency_alerts (candidate_id, alert_key, origin, kind, severity, later, prompt_version)
      values ('${C1}','k1','senalamiento','cambio_de_postura','medio',${LATER},'inconsistency-v1'),
             ('${C2}','k2','senalamiento','tension','bajo',${LATER},'inconsistency-v1');
    insert into inconsistency_scans (candidate_id, status, last_scan_at, reason, prompt_version, judged_keys, cost_usd)
      values ('${C1}','ok',now(),null,'inconsistency-v1','{a,b}',0.0015),
             ('${C2}','insufficient',now(),'Pocas','inconsistency-v1','{}',0);
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

describe("inconsistency_alerts.sql", () => {
  it("el miembro ve solo las alertas y la revisión de su candidato", async () => {
    expect(await as("authenticated", A, "select id from inconsistency_alerts")).toBe(1);
    expect(await as("authenticated", B, "select id from inconsistency_alerts")).toBe(0);
    expect(await as("authenticated", A, "select candidate_id, status, reason, stats from inconsistency_scans")).toBe(1);
  });

  it("la web no lee lo interno de la revisión (costo, pares juzgados)", async () => {
    expect(await as("authenticated", A, "select cost_usd from inconsistency_scans")).toBe("DENIED");
    expect(await as("authenticated", A, "select judged_keys from inconsistency_scans")).toBe("DENIED");
  });

  it("la web solo cambia el estado, y solo de su candidato", async () => {
    expect(
      await as("authenticated", A, `update inconsistency_alerts set status='approved', status_note='ok' returning id`),
    ).toBe(1);
    expect(await as("authenticated", A, `update inconsistency_alerts set explanation='x' returning id`)).toBe("DENIED");
    expect(await as("authenticated", A, `update inconsistency_alerts set status='bogus' returning id`)).toBe("DENIED");
    expect(await as("authenticated", B, `update inconsistency_alerts set status='discarded' returning id`)).toBe(0);
    expect(await as("authenticated", A, `delete from inconsistency_alerts returning id`)).toBe("DENIED");
    expect(
      await as(
        "authenticated",
        A,
        `insert into inconsistency_alerts (candidate_id, alert_key, origin, kind, severity, later, prompt_version)
         values ('${C1}','k3','par','tension','bajo',${LATER},'v') returning id`,
      ),
    ).toBe("DENIED");
    expect(await as("authenticated", A, `update inconsistency_scans set reason='x' returning candidate_id`)).toBe("DENIED");
  });

  it("el clasificador escribe alertas y revisiones pero no cambia ni borra alertas", async () => {
    expect(
      await as(
        "pulso_classifier",
        null,
        `insert into inconsistency_alerts (candidate_id, alert_key, origin, kind, severity, later, prompt_version)
         values ('${C1}','k4','par','contradiccion','alto',${LATER},'inconsistency-v1') returning id`,
      ),
    ).toBe(1);
    expect(
      await as(
        "pulso_classifier",
        null,
        `insert into inconsistency_alerts (candidate_id, alert_key, origin, kind, severity, later, prompt_version)
         values ('${C1}','k4','par','contradiccion','alto',${LATER},'inconsistency-v1')
         on conflict (candidate_id, alert_key) do nothing returning id`,
      ),
    ).toBe(0);
    expect(await as("pulso_classifier", null, `update inconsistency_alerts set status='approved' returning id`)).toBe("DENIED");
    expect(await as("pulso_classifier", null, `delete from inconsistency_alerts returning id`)).toBe("DENIED");
    expect(
      await as("pulso_classifier", null, `update inconsistency_scans set judged_keys='{c}' returning candidate_id`),
    ).toBe(2);
  });

  it("anon y el recolector no entran", async () => {
    expect(await as("anon", null, "select id from inconsistency_alerts")).toBe("DENIED");
    expect(await as("pulso_collector", null, "select id from inconsistency_alerts")).toBe("DENIED");
    expect(await as("anon", null, "select candidate_id from inconsistency_scans")).toBe("DENIED");
  });

  it("rechaza tipos y severidades fuera de la lista", async () => {
    await expect(
      db.query(
        `insert into inconsistency_alerts (candidate_id, alert_key, origin, kind, severity, later, prompt_version)
         values ('${C1}','k9','par','sin_contradiccion','alto',${LATER},'v')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into inconsistency_alerts (candidate_id, alert_key, origin, kind, severity, later, prompt_version)
         values ('${C1}','k9','par','tension','critico',${LATER},'v')`,
      ),
    ).rejects.toThrow();
  });
});
