import { flaggedLookupKey, isActiveFlag, isConversationMention, mentionLookupKey } from "./suspicious-insights";
import type { Mention, SuspiciousAccount, SuspiciousEvidence } from "./types";

export type NetworkEdgeReason = "shared_text" | "coordination" | "group_burst" | "shared_url" | "mention";

export interface NetworkNode {
  id: string;
  kind: "candidate" | "flagged" | "account";
  label: string;
  platform?: string;
  x: number;
  y: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  reason: NetworkEdgeReason;
}

export interface NetworkCluster {
  reason: NetworkEdgeReason;
  nodeIds: string[];
  size: number;
}

export interface SuspiciousNetwork {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  clusters: NetworkCluster[];
  flaggedCount: number;
  pendingReview: number;
  conversationAuthors: number;
  /** Vínculos reales entre cuentas (no el radio hacia el candidato). */
  accountEdges: number;
  gap: string | null;
}

function evidenceKey(account: SuspiciousAccount, ev: SuspiciousEvidence, field: "fingerprint" | "url"): string | null {
  if (field === "fingerprint") {
    const fp = (ev.fingerprint || "").trim();
    return fp ? `fp:${fp}` : null;
  }
  const url = (ev.url || "").trim();
  return url ? `url:${url}` : null;
}

const REASON_RANK: Record<NetworkEdgeReason, number> = {
  coordination: 4,
  group_burst: 3,
  shared_text: 2,
  shared_url: 1,
  mention: 0,
};

function addUndirected(map: Map<string, NetworkEdge>, a: string, b: string, reason: NetworkEdgeReason) {
  if (a === b) return;
  const [from, to] = a < b ? [a, b] : [b, a];
  const key = `${from}|${to}`;
  const prev = map.get(key);
  if (!prev || REASON_RANK[reason] > REASON_RANK[prev.reason]) map.set(key, { from, to, reason });
}

function signalReason(type: string): NetworkEdgeReason | null {
  if (type === "coordination" || type === "self_repeat") return type === "coordination" ? "coordination" : "shared_text";
  if (type === "group_burst") return "group_burst";
  return null;
}

/** Cuentas que comparten fingerprint o URL en la evidencia del detector, o un group_burst. */
export function buildSuspiciousNetwork(
  candidateName: string,
  accounts: SuspiciousAccount[],
  mentions: Mention[],
  opts?: { maxAuthors?: number },
): SuspiciousNetwork {
  const maxAuthors = opts?.maxAuthors ?? 36;
  const active = accounts.filter(isActiveFlag);
  const pendingReview = accounts.filter((a) => a.status === "pending").length;

  const flaggedByKey = new Map<string, SuspiciousAccount>();
  for (const account of active) {
    const key = flaggedLookupKey(account);
    if (key) flaggedByKey.set(key, account);
  }

  const authorCounts = new Map<string, { label: string; platform: string; posts: number }>();
  for (const m of mentions) {
    if (!isConversationMention(m)) continue;
    const key = mentionLookupKey(m);
    if (!key) continue;
    const label = (m.author_handle || m.author || key.split(":")[1] || "cuenta").trim();
    const row = authorCounts.get(key) ?? { label, platform: m.source, posts: 0 };
    row.posts++;
    if (!row.label && label) row.label = label;
    authorCounts.set(key, row);
  }

  const flaggedKeys = [...flaggedByKey.keys()];
  const otherAuthors = [...authorCounts.entries()]
    .filter(([key]) => !flaggedByKey.has(key))
    .sort((a, b) => b[1].posts - a[1].posts)
    .slice(0, Math.max(0, maxAuthors - flaggedKeys.length));

  const nodeIds: { id: string; kind: "flagged" | "account"; label: string; platform: string }[] = [];
  for (const key of flaggedKeys) {
    const acc = flaggedByKey.get(key)!;
    nodeIds.push({
      id: key,
      kind: "flagged",
      label: (acc.handle || acc.display_name || key.split(":")[1] || "cuenta").replace(/^@/, ""),
      platform: acc.platform,
    });
  }
  for (const [key, info] of otherAuthors) {
    nodeIds.push({
      id: key,
      kind: "account",
      label: info.label.replace(/^@/, ""),
      platform: info.platform,
    });
  }

  const groups = new Map<string, { reason: NetworkEdgeReason; ids: Set<string> }>();
  const pushGroup = (bucket: string, reason: NetworkEdgeReason, id: string) => {
    const row = groups.get(bucket) ?? { reason, ids: new Set() };
    row.ids.add(id);
    groups.set(bucket, row);
  };

  for (const account of active) {
    const id = flaggedLookupKey(account);
    if (!id) continue;
    for (const signal of account.signals) {
      const reason = signalReason(signal.type);
      if (!reason) continue;
      for (const ev of signal.evidence) {
        const fp = evidenceKey(account, ev, "fingerprint");
        if (fp) pushGroup(`${reason}:${fp}`, reason === "group_burst" ? "group_burst" : reason === "coordination" ? "coordination" : "shared_text", id);
        const url = evidenceKey(account, ev, "url");
        if (url && reason !== "group_burst") pushGroup(`shared_url:${url}`, "shared_url", id);
      }
      if (signal.type === "group_burst") {
        const evKey = signal.evidence
          .map((e) => e.mention_id || e.published_at)
          .sort()
          .join(",");
        if (evKey) pushGroup(`group_burst:${evKey}`, "group_burst", id);
      }
    }
  }

  const edgeMap = new Map<string, NetworkEdge>();
  const clusters: NetworkCluster[] = [];
  for (const group of groups.values()) {
    const ids = [...group.ids];
    if (ids.length < 2) continue;
    clusters.push({ reason: group.reason, nodeIds: ids, size: ids.length });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) addUndirected(edgeMap, ids[i], ids[j], group.reason);
    }
  }
  clusters.sort((a, b) => b.size - a.size);

  const width = 640;
  const height = 420;
  const cx = width / 2;
  const cy = height / 2;
  const nodes: NetworkNode[] = [{ id: "candidate", kind: "candidate", label: initials(candidateName), x: cx, y: cy }];

  const clusterIds = new Set(clusters[0]?.nodeIds ?? []);
  const flagged = nodeIds.filter((n) => n.kind === "flagged");
  const plain = nodeIds.filter((n) => n.kind === "account");
  const clustered = flagged.filter((n) => clusterIds.has(n.id));
  const flaggedRest = flagged.filter((n) => !clusterIds.has(n.id));

  placeRing(clustered, cx + 170, cy - 70, 70, 0.15, nodes);
  placeRing(flaggedRest, cx, cy, 155, Math.PI * 0.15, nodes);
  placeRing(plain, cx, cy, 200, -Math.PI * 0.2, nodes);

  const present = new Set(nodes.map((n) => n.id));
  const accountEdges = [...edgeMap.values()].filter((e) => present.has(e.from) && present.has(e.to));
  const spokes: NetworkEdge[] = nodes
    .filter((n) => n.kind !== "candidate")
    .map((n) => ({ from: "candidate", to: n.id, reason: "mention" }));

  let gap: string | null = null;
  if (active.length === 0 && authorCounts.size === 0) {
    gap = "No hay cuentas ni menciones de conversación en este período para armar una red.";
  } else if (accountEdges.length === 0) {
    gap =
      "Se muestran las cuentas reales (en rojo, las marcadas). No hay evidencia compartida (mismo texto, misma URL o ráfaga de grupo) para dibujar vínculos entre ellas: no se inventan aristas.";
  }

  return {
    nodes,
    edges: [...spokes, ...accountEdges],
    clusters,
    flaggedCount: active.length,
    pendingReview,
    conversationAuthors: authorCounts.size,
    accountEdges: accountEdges.length,
    gap,
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function placeRing(
  items: { id: string; kind: "flagged" | "account"; label: string; platform: string }[],
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  nodes: NetworkNode[],
) {
  const n = items.length;
  if (n === 0) return;
  for (let i = 0; i < n; i++) {
    const angle = startAngle + (2 * Math.PI * i) / n - Math.PI / 2;
    nodes.push({
      id: items[i].id,
      kind: items[i].kind,
      label: items[i].label,
      platform: items[i].platform,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
}
