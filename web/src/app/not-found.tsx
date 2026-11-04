import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <div className="mb-6 flex justify-center"><Brand size="lg" /></div>
        <h1 className="text-lg font-semibold">No encontramos esa página</h1>
        <p className="mt-2 text-sm text-slate-500">Puede que no exista o que no tengas acceso.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-indigo-600">Volver al inicio</Link>
      </div>
    </main>
  );
}
