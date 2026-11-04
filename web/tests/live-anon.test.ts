/**
 * Humo contra el Supabase real, SOLO con la clave publishable y sin sesión.
 * Se ejecuta con PULSO_LIVE_TEST=1. Verifica que:
 *   - un visitante anónimo no puede leer ninguna tabla (sin acceso público);
 *   - las consultas de SupabaseRepo son sintácticamente válidas para
 *     PostgREST (el rechazo es por permisos, no por parseo).
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseRepo } from "@/lib/data/supabase";
import { parseFilters } from "@/lib/filters";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = process.env.PULSO_LIVE_TEST === "1" && url && key;
const CID = "2c4f83ed-f2bd-4afe-89a3-fa6263cc5b7e";

describe.skipIf(!live)("Supabase real, sin sesión", () => {
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  const repo = SupabaseRepo.fromClient(db);

  it.each(["candidates", "mentions", "topics", "source_runs", "candidate_sources", "daily_usage", "source_catalog"])(
    "anon no puede leer %s",
    async (table) => {
      const { data, error } = await db.from(table).select("*").limit(1);
      expect(data ?? []).toHaveLength(0);
      expect(error?.code).toBe("42501"); // permission denied
    },
  );

  const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied/i);

  it("las consultas del repo llegan a Postgres y se rechazan por permisos", async () => {
    await denied(repo.getCandidate("axel-kicillof"));
    await denied(repo.listTopics(CID));
    await denied(repo.mentionsSince(CID, new Date(Date.now() - 7 * 86400000).toISOString()));
    await denied(
      repo.searchMentions(
        CID,
        parseFilters({ tone: "negativas", target: "candidate", relevance: "alta", from: "2026-11-01", to: "2026-11-04", q: "reelección indefinida" }),
        25,
      ),
    );
    await denied(repo.searchMentions(CID, parseFilters({ tone: "pendiente", source: "rss_media", page: "2" }), 25));
    await denied(repo.listSourceRuns(CID, 40));
    await denied(repo.listCandidateSources(CID));
  });
});
