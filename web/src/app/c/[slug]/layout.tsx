import { Brand } from "@/components/brand";
import { Nav } from "@/components/nav";
import { signOut } from "@/app/auth/actions";
import { loadCandidate } from "@/lib/context";
import { formatDateTime, TZ_LABEL } from "@/lib/time";

export default async function CandidateLayout({ children, params }: LayoutProps<"/c/[slug]">) {
  const { slug } = await params;
  const { viewer, candidate, repo } = await loadCandidate(slug);
  const exportedAt = viewer.fixture ? await repo.dataTimestamp() : null;

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:py-6">
          <Brand />
        </div>
        <div className="px-5 pb-4 lg:pb-6">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Candidato</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{candidate.name}</p>
          <p className="text-xs text-slate-500">Elecciones 2027 · Argentina</p>
        </div>
        <div className="px-3 pb-4">
          <Nav slug={candidate.slug} />
        </div>
        <div className="mt-auto hidden border-t border-slate-100 px-5 py-4 lg:block">
          <p className="truncate text-xs text-slate-500" title={viewer.email}>{viewer.email}</p>
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
            {exportedAt ? ` el ${formatDateTime(exportedAt)} (${TZ_LABEL})` : ""}, sin login. No se
            actualizan solos y este modo no funciona fuera de esta computadora.
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
