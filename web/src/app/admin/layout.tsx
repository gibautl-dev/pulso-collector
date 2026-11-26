import Link from "next/link";
import { Brand } from "@/components/brand";
import { signOut } from "@/app/auth/actions";
import { requireStaff } from "@/lib/context";

export const metadata = { title: "Panel Active · Pulso" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { viewer } = await requireStaff();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Brand />
          <div className="text-right">
            <p className="truncate text-xs text-slate-500" title={viewer.email}>{viewer.email}</p>
            <p className="text-xs font-medium text-slate-700">Panel Active</p>
          </div>
        </div>
      </header>
      {viewer.fixture ? (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-900">
          <strong>Modo local de prueba:</strong> sin login. Lo que cargues en este panel es de demostración para ver la interfaz, no una carga oficial.
        </div>
      ) : null}
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/" className="text-sm text-indigo-700 hover:underline">
            ← Volver a Pulso
          </Link>
          <Link href="/admin/candidatos" className="text-sm font-medium text-slate-700 hover:underline">
            Candidatos
          </Link>
          <Link href="/admin/rivales" className="text-sm font-medium text-slate-700 hover:underline">
            Rivales
          </Link>
          <Link href="/admin/temas" className="text-sm font-medium text-slate-700 hover:underline">
            Temas a medida
          </Link>
          <Link href="/admin/gasto" className="text-sm font-medium text-slate-700 hover:underline">
            Gasto
          </Link>
        </div>
        <form action={signOut} className="mt-1">
          <button type="submit" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
            Cerrar sesión
          </button>
        </form>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
