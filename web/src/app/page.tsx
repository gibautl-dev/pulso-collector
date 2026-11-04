import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/context";
import { getRepo } from "@/lib/data/repo";
import { Brand } from "@/components/brand";
import { signOut } from "@/app/auth/actions";

export default async function Home() {
  const viewer = await requireViewer();
  const repo = await getRepo();
  const candidates = await repo.listCandidates();
  if (candidates.length > 0) redirect(`/c/${candidates[0].slug}`);
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
