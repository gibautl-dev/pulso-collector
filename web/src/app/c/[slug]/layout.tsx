import Link from "next/link";
import { Brand } from "@/components/brand";
import { CandidateHeading, CandidateSwitcher } from "@/components/candidate-switcher";
import { Nav } from "@/components/nav";
import { signOut } from "@/app/auth/actions";
import { loadCandidate } from "@/lib/context";
import { regionFor } from "@/lib/region";
import { clockFromRegion, formatDateTime } from "@/lib/time";

export default async function CandidateLayout({ children, params }: LayoutProps<"/c/[slug]">) {
  const { slug } = await params;
  const { viewer, candidate, candidates, repo } = await loadCandidate(slug);
  const exportedAt = viewer.fixture ? await repo.dataTimestamp() : null;
  const region = regionFor(candidate.slug);
  const clock = clockFromRegion(region);
  const showSwitcher = candidates.length > 1;
  const staff = await repo.isStaff();

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:py-6">
          <Brand />
        </div>
        <div className="px-5 pb-4 lg:pb-6">
          {showSwitcher ? (
            <CandidateSwitcher candidates={candidates} current={candidate} />
          ) : (
            <CandidateHeading candidate={candidate} electionLabel={region.electionLabel} />
          )}
        </div>
        <div className="px-3 pb-4">
          <Nav slug={candidate.slug} showAds={region.showMetaAds || region.showGoogleAds} />
        </div>
        <div className="mt-auto hidden border-t border-slate-100 px-5 py-4 lg:block">
          <p className="truncate text-xs text-slate-500" title={viewer.email}>{viewer.email}</p>
          {staff ? (
            <p className="mt-2 space-y-1">
              <Link href="/admin/rivales" className="block text-xs font-medium text-indigo-600 hover:text-indigo-500">
                Panel Active · Rivales
              </Link>
              <Link href="/admin/temas" className="block text-xs font-medium text-indigo-600 hover:text-indigo-500">
                Panel Active · Temas a medida
              </Link>
            </p>
          ) : null}
          <form action={signOut}>
            <button type="submit" className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {viewer.fixture && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-900">
            <strong>Modo local de prueba:</strong> datos reales exportados de Supabase
            {exportedAt ? ` el ${formatDateTime(exportedAt, clock)} (${clock.tzLabel})` : ""}, sin login. No se
            actualizan solos y este modo no funciona fuera de esta computadora.
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
