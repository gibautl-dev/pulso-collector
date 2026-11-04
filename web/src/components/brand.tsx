export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm ${big ? "h-11 w-11" : "h-8 w-8"}`}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className={big ? "h-6 w-6" : "h-4.5 w-4.5"} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h4l2.5-6 4 12 3-8 1.5 2H22" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight text-slate-900 ${big ? "text-2xl" : "text-base"}`}>Pulso</span>
        <span className={`block text-slate-500 ${big ? "text-xs" : "text-[10px]"} uppercase tracking-wider`}>
          by Active Marketing
        </span>
      </span>
    </div>
  );
}
