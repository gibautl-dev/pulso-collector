"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, string> = {
  tablero: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  menciones: "M4 6h16M4 12h16M4 18h10",
  fuentes: "M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2l2.8 2.8M5.6 18.4l2.8-2.8m7.2-7.2l2.8-2.8",
};

export function Nav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/c/${slug}`;
  const items = [
    { href: base, label: "Tablero", icon: "tablero", active: pathname === base },
    { href: `${base}/menciones`, label: "Menciones", icon: "menciones", active: pathname.startsWith(`${base}/menciones`) },
    { href: `${base}/fuentes`, label: "Salud de fuentes", icon: "fuentes", active: pathname.startsWith(`${base}/fuentes`) },
  ];
  return (
    <nav className="flex gap-1 lg:flex-col">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            it.active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICONS[it.icon]} />
          </svg>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
