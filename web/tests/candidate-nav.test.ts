import { describe, expect, it } from "vitest";
import {
  hrefForCandidate,
  homeDestination,
  parseCandidatePath,
  parseCandidateSlug,
  sectionAvailable,
} from "@/lib/candidate-nav";

const kicillof = { slug: "axel-kicillof", name: "Axel Kicillof" };
const pedro = { slug: "pedro-sanchez", name: "Pedro Sánchez" };

describe("parseCandidateSlug", () => {
  it("acepta slugs simples y rechaza basura", () => {
    expect(parseCandidateSlug("pedro-sanchez")).toBe("pedro-sanchez");
    expect(parseCandidateSlug("axel-kicillof")).toBe("axel-kicillof");
    expect(parseCandidateSlug("")).toBeNull();
    expect(parseCandidateSlug("Pedro")).toBeNull();
    expect(parseCandidateSlug("../x")).toBeNull();
    expect(parseCandidateSlug("a b")).toBeNull();
  });
});

describe("parseCandidatePath", () => {
  it("saca el slug y la pestaña, sin el id de un detalle", () => {
    expect(parseCandidatePath("/c/axel-kicillof")).toEqual({ slug: "axel-kicillof", section: "" });
    expect(parseCandidatePath("/c/axel-kicillof/anuncios")).toEqual({
      slug: "axel-kicillof",
      section: "anuncios",
    });
    expect(parseCandidatePath("/c/pedro-sanchez/menciones/abc-123")).toEqual({
      slug: "pedro-sanchez",
      section: "menciones",
    });
    expect(parseCandidatePath("/login")).toBeNull();
  });
});

describe("hrefForCandidate", () => {
  it("conserva la pestaña cuando existe en el destino", () => {
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof/ia")).toBe("/c/pedro-sanchez/ia");
    expect(hrefForCandidate("axel-kicillof", "/c/pedro-sanchez/menciones/xyz")).toBe(
      "/c/axel-kicillof/menciones",
    );
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof")).toBe("/c/pedro-sanchez");
  });

  it("vuelve al tablero si Anuncios no está en el destino (España)", () => {
    expect(sectionAvailable("anuncios", "axel-kicillof")).toBe(true);
    expect(sectionAvailable("anuncios", "pedro-sanchez")).toBe(false);
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof/anuncios")).toBe("/c/pedro-sanchez");
    expect(hrefForCandidate("axel-kicillof", "/c/pedro-sanchez/anuncios")).toBe(
      "/c/axel-kicillof/anuncios",
    );
  });

  it("conserva Acción en el otro candidato (la bandeja puede estar vacía)", () => {
    expect(sectionAvailable("accion", "pedro-sanchez")).toBe(true);
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof/accion/abc-123")).toBe(
      "/c/pedro-sanchez/accion",
    );
  });

  it("conserva Comparación en el otro candidato", () => {
    expect(sectionAvailable("comparacion", "pedro-sanchez")).toBe(true);
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof/comparacion")).toBe(
      "/c/pedro-sanchez/comparacion",
    );
  });

  it("vuelve al tablero si la pestaña no existe", () => {
    expect(hrefForCandidate("pedro-sanchez", "/c/axel-kicillof/no-existe")).toBe("/c/pedro-sanchez");
  });
});

describe("homeDestination", () => {
  it("sin candidatos o con uno solo no muestra el selector", () => {
    expect(homeDestination([], undefined)).toEqual({ type: "empty" });
    expect(homeDestination([kicillof], undefined)).toEqual({
      type: "redirect",
      slug: "axel-kicillof",
    });
    expect(homeDestination([kicillof], "pedro-sanchez")).toEqual({
      type: "redirect",
      slug: "axel-kicillof",
    });
  });

  it("con varios, usa la cookie si el candidato sigue visible", () => {
    const both = [kicillof, pedro];
    expect(homeDestination(both, "pedro-sanchez")).toEqual({
      type: "redirect",
      slug: "pedro-sanchez",
    });
    expect(homeDestination(both, undefined)).toEqual({ type: "chooser" });
    expect(homeDestination(both, "otro-que-ya-no-ve")).toEqual({ type: "chooser" });
    expect(homeDestination(both, "No-Valido")).toEqual({ type: "chooser" });
  });
});
