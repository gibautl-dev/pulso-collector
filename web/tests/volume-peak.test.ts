import { describe, expect, it } from "vitest";
import type { DayVolume } from "@/lib/analytics";
import { formatPeriodChange, periodChange, volumePeak } from "@/lib/volume-peak";

function day(day: string, total: number): DayVolume {
  return { day, total, positivo: 0, neutral: total, negativo: 0, pendiente: 0 };
}

describe("periodChange", () => {
  it("calcula el porcentaje contra la ventana anterior", () => {
    expect(periodChange(120, 100)).toEqual({ percent: 20, previous: 100 });
    expect(periodChange(80, 100)).toEqual({ percent: -20, previous: 100 });
  });
  it("sin base anterior no inventa un porcentaje", () => {
    expect(periodChange(10, 0).percent).toBeNull();
    expect(formatPeriodChange(null, 7)).toBe("sin base anterior");
    expect(formatPeriodChange(12, 7)).toBe("+12% vs semana anterior");
    expect(formatPeriodChange(-5, 14)).toBe("-5% vs período anterior de 14 días");
  });
});

describe("volumePeak", () => {
  it("compara el máximo con el promedio de los demás días, no con el día previo", () => {
    const peak = volumePeak([
      day("2026-11-20", 10),
      day("2026-11-21", 10),
      day("2026-11-22", 10),
      day("2026-11-23", 40),
    ]);
    expect(peak?.day).toBe("2026-11-23");
    expect(peak?.percent).toBe(300);
  });
  it("no muestra pico si no supera el 15% del promedio del resto", () => {
    expect(volumePeak([day("2026-11-20", 100), day("2026-11-21", 110)])).toBeNull();
  });
  it("no inventa un pico con un solo día o todos en cero", () => {
    expect(volumePeak([day("2026-11-20", 50)])).toBeNull();
    expect(volumePeak([day("2026-11-20", 0), day("2026-11-21", 0)])).toBeNull();
  });
  it("si el resto está en cero, muestra el pico sin inventar un porcentaje", () => {
    const peak = volumePeak([day("2026-11-18", 130), day("2026-11-19", 0), day("2026-11-20", 0)]);
    expect(peak?.day).toBe("2026-11-18");
    expect(peak?.percent).toBeNull();
  });
});
