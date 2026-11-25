// Capturas locales del panel /admin/rivales con sugerencias de IA y altas pendientes.
// Uso: node scripts/screenshots-25.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3125", out = "/workspace/pulso/screens"] = process.argv.slice(2);

const browser = await chromium.launch();

async function open(contextOpts) {
  const ctx = await browser.newContext({ locale: "es-AR", ...contextOpts });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}/admin/rivales`, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`/admin/rivales status ${res?.status()}`);
  }
  return { ctx, page, status: res.status() };
}

async function shotFull(contextOpts, file) {
  const { ctx, page, status } = await open(contextOpts);
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  console.log(file, page.url(), status);
  await ctx.close();
}

async function shotCard(contextOpts, slug, file) {
  const { ctx, page, status } = await open(contextOpts);
  const loc = page.locator(`#rivales-${slug}`);
  await loc.waitFor({ state: "visible", timeout: 15000 });
  await loc.screenshot({ path: `${out}/${file}` });
  console.log(file, page.url(), status, slug);
  await ctx.close();
}

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

await shotFull(desktop, "25-admin-rivales-desktop.png");
await shotFull(mobile, "25-admin-rivales-mobile.png");
await shotCard(desktop, "axel-kicillof", "25-kicillof-sugerencias-desktop.png");
await shotCard(mobile, "axel-kicillof", "25-kicillof-sugerencias-mobile.png");
await shotCard(desktop, "pedro-sanchez", "25-sanchez-sugerencias-desktop.png");
await shotCard(mobile, "pedro-sanchez", "25-sanchez-sugerencias-mobile.png");

await browser.close();
