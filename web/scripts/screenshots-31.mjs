// Capturas locales (fixture de ejemplo) del tablero con las tarjetas de
// Comparación, Equipo de acción y Temas a medida al final de la página.
// Uso: node scripts/screenshots-31.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3131", out = "/workspace/pulso/screens"] = process.argv.slice(2);

const browser = await chromium.launch();
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

async function shot(path, file, contextOpts) {
  const ctx = await browser.newContext({ locale: "es-AR", ...contextOpts });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${path} status ${res?.status()}`);
  }
  // Página completa para que se vea la nueva posición, al final del tablero.
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  console.log(file, page.url(), res.status());
  await ctx.close();
}

await shot("/c/axel-kicillof", "31-overview-kicillof-desktop.png", desktop);
await shot("/c/axel-kicillof", "31-overview-kicillof-mobile.png", mobile);
await shot("/c/pedro-sanchez", "31-overview-sanchez-desktop.png", desktop);

await browser.close();
