import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isFixtureMode } from "@/lib/mode";
import { createClient } from "@/lib/supabase/server";
import { getRepo, type PulsoRepo } from "@/lib/data/repo";
import type { Candidate } from "@/lib/types";

export interface Viewer {
  email: string;
  fixture: boolean;
}

/** Verifica la sesión (firma del JWT) en el servidor; si no hay, a /login. */
export const requireViewer = cache(async (): Promise<Viewer> => {
  if (isFixtureMode()) return { email: "modo local", fixture: true };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  return { email: typeof claims.email === "string" ? claims.email : "usuario", fixture: false };
});

export interface CandidateContext {
  viewer: Viewer;
  repo: PulsoRepo;
  candidate: Candidate;
  candidates: Candidate[];
}

/** Sesión + candidato visible para el usuario (RLS). 404 si no tiene acceso. */
export const loadCandidate = cache(async (slug: string): Promise<CandidateContext> => {
  const viewer = await requireViewer();
  const repo = await getRepo();
  const [candidate, candidates] = await Promise.all([repo.getCandidate(slug), repo.listCandidates()]);
  if (!candidate) notFound();
  return { viewer, repo, candidate, candidates };
});
