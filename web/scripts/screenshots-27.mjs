// Capturas locales del arreglo de rivales, Salud de fuentes (Meta) y nav de Temas a medida.
// Uso: node scripts/screenshots-27.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3127", out = "/workspace/pulso/screens"] = process.argv.slice(2);

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

await shot("/admin/rivales", "27-admin-rivales-desktop.png", desktop);
await shot("/admin/rivales", "27-kicillof-rivales-desktop.png", desktop, "#rivales-axel-kicillof");
await shot("/admin/rivales", "27-sanchez-rivales-desktop.png", desktop, "#rivales-pedro-sanchez");

// Feedback: pedido duplicado (Milei ya está en el fixture de Kicillof).
{
  const { ctx, page, status } = await open("/admin/rivales", desktop);
  const card = page.locator("#rivales-axel-kicillof");
  await card.getByLabel("Nombre").fill("Javier Milei");
  await card.getByRole("button", { name: "Pedir alta pendiente" }).click();
  await page.getByText("Ya hay un pedido de alta para Javier Milei").waitFor({ timeout: 15000 });
  await card.screenshot({ path: `${out}/27-kicillof-alta-duplicado-desktop.png` });
  console.log("27-kicillof-alta-duplicado-desktop.png", page.url(), status);
  await ctx.close();
}

// Sugerir rivales sin clave: mensaje amable, no un crash.
{
  const { ctx, page, status } = await open("/admin/rivales", desktop);
  const card = page.locator("#rivales-axel-kicillof");
  await card.getByRole("button", { name: /Sugerir rivales con IA|Pedir una nueva sugerencia/ }).click();
  await page.getByText("La IA no está configurada en el servidor todavía").waitFor({ timeout: 15000 });
  await card.locator("section").first().screenshot({ path: `${out}/27-kicillof-ia-sin-clave-desktop.png` }).catch(async () => {
    await card.screenshot({ path: `${out}/27-kicillof-ia-sin-clave-desktop.png` });
  });
  console.log("27-kicillof-ia-sin-clave-desktop.png", page.url(), status);
  await ctx.close();
}

await shot("/c/axel-kicillof/fuentes", "27-salud-fuentes-kicillof-desktop.png", desktop);
await shot("/c/pedro-sanchez/fuentes", "27-salud-fuentes-sanchez-desktop.png", desktop);

for (const [slug, tag] of [
  ["axel-kicillof", "kicillof"],
  ["pedro-sanchez", "sanchez"],
]) {
  await shot(`/c/${slug}`, `27-nav-temas-${tag}-desktop.png`, desktop);
  await shot(`/c/${slug}`, `27-nav-temas-${tag}-mobile.png`, mobile);
  await shot(`/c/${slug}/temas`, `27-temas-${tag}-desktop.png`, desktop);
}

await browser.close();
