/** Color y leyenda del balance (−100 a +100). Verde >5, rojo <−5, gris en el resto. */

export type BalanceTone = "positive" | "negative" | "default";

export function balanceTone(value: number | null | undefined): BalanceTone {
  if (typeof value !== "number" || Number.isNaN(value)) return "default";
  if (value > 5) return "positive";
  if (value < -5) return "negative";
  return "default";
}

export function balanceCaption(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "Sin tono clasificado";
  const tone = balanceTone(value);
  if (tone === "positive") return "A favor";
  if (tone === "negative") return "En contra";
  return "Neutro";
}
