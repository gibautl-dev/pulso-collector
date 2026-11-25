import type { SuspiciousNetwork } from "@/lib/suspicious-network";

export function SuspiciousNetworkGraph({ network }: { network: SuspiciousNetwork }) {
  const width = 640;
  const height = 420;
  const byId = new Map(network.nodes.map((n) => [n.id, n]));
  const cluster = network.clusters[0] ?? null;
  const clusterIds = new Set(cluster?.nodeIds ?? []);
  const clusterNodes = network.nodes.filter((n) => clusterIds.has(n.id));
  const clusterCx = clusterNodes.length ? clusterNodes.reduce((s, n) => s + n.x, 0) / clusterNodes.length : 0;
  const clusterCy = clusterNodes.length ? clusterNodes.reduce((s, n) => s + n.y, 0) / clusterNodes.length : 0;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[360px] w-full" role="img" aria-label="Red de cuentas que hablan del candidato">
        {cluster && clusterNodes.length >= 2 ? (
          <circle cx={clusterCx} cy={clusterCy} r="88" fill="#fff1f2" stroke="#fecdd3" strokeWidth="1" />
        ) : null}
        {network.edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const clustered = e.reason !== "mention" && clusterIds.has(e.from) && clusterIds.has(e.to);
          const mention = e.reason === "mention";
          return (
            <line
              key={`${e.from}-${e.to}-${e.reason}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={clustered ? "#e11d48" : mention ? "#cbd5e1" : "#94a3b8"}
              strokeWidth={clustered ? 1.6 : 1}
              strokeDasharray={clustered ? "4 3" : undefined}
            />
          );
        })}
        {network.nodes.map((n) => {
          if (n.kind === "candidate") {
            return (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r="26" fill="#6d28d9" />
                <text x={n.x} y={n.y + 5} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700">
                  {n.label}
                </text>
              </g>
            );
          }
          const r = n.kind === "flagged" ? 8 : 6;
          const fill = n.kind === "flagged" ? "#e11d48" : "#94a3b8";
          return (
            <g key={n.id}>
              <title>{n.label}</title>
              <circle cx={n.x} cy={n.y} r={r} fill={fill} />
            </g>
          );
        })}
      </svg>
      {cluster && cluster.size >= 2 ? (
        <span className="absolute right-4 top-4 inline-flex items-center rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
          Grupo coordinado · {cluster.size}
        </span>
      ) : null}
    </div>
  );
}
