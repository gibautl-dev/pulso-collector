/* eslint-disable @next/next/no-img-element */

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
        <span className={`mt-0.5 flex items-center gap-1 text-slate-500 ${big ? "text-xs" : "text-[10px]"} uppercase tracking-wider`}>
          <img
            src="/brand/active-mark.png"
            alt="Active Marketing"
            className={big ? "h-3.5 w-auto object-contain" : "h-3 w-auto object-contain"}
          />
          <span>by Active Marketing</span>
        </span>
      </span>
    </div>
  );
}

export function ActiveMarketingLogo({ variant = "mark" }: { variant?: "mark" | "full" }) {
  if (variant === "full") {
    return (
      <img
        src="/brand/active-logo.png"
        alt="Active Marketing · Digital Agency"
        className="mx-auto h-12 w-auto object-contain opacity-90"
      />
    );
  }
  return (
    <div className="flex items-center gap-2 text-slate-500">
      <img
        src="/brand/active-mark.png"
        alt="Active Marketing"
        className="h-4 w-auto object-contain"
      />
      <span className="text-[11px] font-medium tracking-wide text-slate-500">Active Marketing</span>
    </div>
  );
}
