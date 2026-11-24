import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/context";
import { getRepo } from "@/lib/data/repo";
import { Brand } from "@/components/brand";
import { signOut } from "@/app/auth/actions";
import { LAST_CANDIDATE_COOKIE, homeDestination } from "@/lib/candidate-nav";
import { regionFor } from "@/lib/region";

export default async function Home() {
  const viewer = await requireViewer();
  const repo = await getRepo();
  const candidates = await repo.listCandidates();
  const jar = await cookies();
  const destination = homeDestination(candidates, jar.get(LAST_CANDIDATE_COOKIE)?.value);
  if (destination.type === "redirect") redirect(`/c/${destination.slug}`);

  if (destination.type === "chooser") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center"><Brand size="lg" /></div>
          <h1 className="text-lg font-semibold text-slate-900">Elegí un candidato</h1>
          <p className="mt-2 text-sm text-slate-500">
            Tenés acceso a más de un candidato. La próxima vez te llevamos al último que visitaste;
            también podés cambiar desde el menú de la barra lateral.
          </p>
          <ul className="mt-6 space-y-3" data-testid="candidate-chooser">
            {candidates.map((c) => {
              const region = regionFor(c.slug);
              return (
                <li key={c.slug}>
                  <Link
                    href={`/c/${c.slug}`}
                    className="block rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                  >
                    <span className="block text-sm font-semibold text-slate-900">{c.name}</span>
                    <span className="mt-0.5 block text-xs font-medium text-slate-600">{region.countryName}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{region.electionLabel}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 truncate text-center text-xs text-slate-500" title={viewer.email}>{viewer.email}</p>
          <form action={signOut} className="mt-2 text-center">
            <button className="text-sm font-medium text-indigo-600 hover:text-indigo-500">Cerrar sesión</button>
          </form>
        </div>
      </main>
    );
  }

  // Autenticado pero sin membresía: no ve ningún dato.
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <div className="mb-6 flex justify-center"><Brand size="lg" /></div>
        <h1 className="text-lg font-semibold text-slate-900">Todavía no tenés candidatos asignados</h1>
        <p className="mt-2 text-sm text-slate-500">
          Ingresaste como {viewer.email}. Pedile a Active Marketing que te dé acceso.
        </p>
        <form action={signOut} className="mt-6">
          <button className="text-sm font-medium text-indigo-600 hover:text-indigo-500">Cerrar sesión</button>
        </form>
      </div>
    </main>
  );
}
