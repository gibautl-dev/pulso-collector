import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { isFixtureMode } from "@/lib/mode";
import { requestMagicLink } from "./actions";

export const metadata = { title: "Ingresar · Pulso" };

const ERRORS: Record<string, string> = {
  email: "Revisá el email: no parece válido.",
  rate: "Pediste demasiados links seguidos. Esperá un minuto y probá de nuevo.",
  link: "El link venció o ya se usó. Pedí uno nuevo.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isFixtureMode()) redirect("/");
  const sp = await searchParams;
  const sent = sp.sent === "1";
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand size="lg" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Ingresá a tu cuenta</h1>
          <p className="mt-1 text-sm text-slate-500">
            Acceso solo por invitación. Te mandamos un link de ingreso a tu email.
          </p>
          {sent ? (
            <div className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
              Si tu email tiene acceso, en unos minutos te llega un link para entrar. Revisá también
              la carpeta de spam.
            </div>
          ) : (
            <form action={requestMagicLink} className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Email</span>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="nombre@empresa.com"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              {error && (
                <p className="text-sm text-rose-600" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                Enviarme el link
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          ¿No tenés acceso? Pedíselo a tu contacto en Active Marketing.
        </p>
      </div>
    </main>
  );
}
