// Capturas de las secciones rediseñadas (PP-11) para Kicillof y Sánchez.
// Uso: node scripts/screenshots-32.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3132", out = "/workspace/pulso/screens"] = process.argv.slice(2);

const browser = await chromium.launch();
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

async function shot(path, file) {
  const ctx = await browser.newContext({ locale: "es-AR", ...desktop });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${path} status ${res?.status()}`);
  }
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  console.log(file, page.url(), res.status());
  await ctx.close();
}

for (const slug of ["axel-kicillof", "pedro-sanchez"]) {
  const who = slug === "axel-kicillof" ? "kicillof" : "sanchez";
  await shot(`/c/${slug}`, `32-tablero-${who}-desktop.png`);
  await shot(`/c/${slug}/comparacion`, `32-rivales-${who}-desktop.png`);
  await shot(`/c/${slug}/sospechosas`, `32-sospechosas-${who}-desktop.png`);
  await shot(`/c/${slug}/ia`, `32-ia-${who}-desktop.png`);
  await shot(`/c/${slug}/anuncios`, `32-anuncios-${who}-desktop.png`);
}

await browser.close();
