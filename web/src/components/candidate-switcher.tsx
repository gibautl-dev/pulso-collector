"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { hrefForCandidate } from "@/lib/candidate-nav";
import { regionFor } from "@/lib/region";
import type { Candidate } from "@/lib/types";

export function CandidateSwitcher({
  candidates,
  current,
}: {
  candidates: Candidate[];
  current: Candidate;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonId = useId();
  const listId = useId();
  const currentRegion = regionFor(current.slug);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-testid="candidate-switcher">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Candidato</p>
      <button
        type="button"
        id={buttonId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Cambiar de candidato"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 flex w-full items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm hover:border-slate-300 hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">{current.name}</span>
          <span className="block truncate text-xs text-slate-500">{currentRegion.countryName}</span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={buttonId}
          className="relative z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {candidates.map((c) => {
            const region = regionFor(c.slug);
            const selected = c.slug === current.slug;
            return (
              <li key={c.slug} role="option" aria-selected={selected}>
                <Link
                  href={hrefForCandidate(c.slug, pathname)}
                  onClick={() => setOpen(false)}
                  className={`block px-2.5 py-2 hover:bg-slate-50 ${selected ? "bg-indigo-50" : ""}`}
                >
                  <span className={`block truncate text-sm font-medium ${selected ? "text-indigo-700" : "text-slate-900"}`}>
                    {c.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{region.countryName}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">{currentRegion.electionLabel}</p>
    </div>
  );
}

export function CandidateHeading({
  candidate,
  electionLabel,
}: {
  candidate: Candidate;
  electionLabel: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Candidato</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{candidate.name}</p>
      <p className="text-xs text-slate-500">{electionLabel}</p>
    </div>
  );
}
