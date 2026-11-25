// Capturas locales de Anuncios de Google (junto a Meta) y Salud de fuentes.
// Uso: node scripts/screenshots-29.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3129", out = "/workspace/pulso/screens"] = process.argv.slice(2);

const browser = await chromium.launch();
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

async function open(path, contextOpts) {
  const ctx = await browser.newContext({ locale: "es-AR", ...contextOpts });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${path} status ${res?.status()}`);
  }
  return { ctx, page, status: res.status() };
}

async function shot(path, file, contextOpts, locator) {
  const { ctx, page, status } = await open(path, contextOpts);
  if (locator) {
    const loc = page.locator(locator);
    await loc.waitFor({ state: "visible", timeout: 15000 });
    await loc.screenshot({ path: `${out}/${file}` });
  } else {
    await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  }
  console.log(file, page.url(), status);
  await ctx.close();
}

await shot("/c/axel-kicillof/anuncios", "29-kicillof-anuncios-desktop.png", desktop);
await shot("/c/axel-kicillof/anuncios", "29-kicillof-anuncios-google-desktop.png", desktop, "#anuncios-google");
await shot("/c/axel-kicillof/anuncios", "29-kicillof-anuncios-mobile.png", mobile);
await shot("/c/pedro-sanchez/anuncios", "29-sanchez-anuncios-desktop.png", desktop);
await shot("/c/pedro-sanchez/anuncios", "29-sanchez-anuncios-mobile.png", mobile);
await shot("/c/axel-kicillof/fuentes", "29-salud-fuentes-kicillof-desktop.png", desktop);
await shot("/c/axel-kicillof/fuentes", "29-salud-google-kicillof-desktop.png", desktop, "#salud-google-ads");
await shot("/c/pedro-sanchez/fuentes", "29-salud-fuentes-sanchez-desktop.png", desktop);
await shot("/c/pedro-sanchez/fuentes", "29-salud-google-sanchez-desktop.png", desktop, "#salud-google-ads");

await browser.close();
