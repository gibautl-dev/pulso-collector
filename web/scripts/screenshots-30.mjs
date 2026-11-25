// Capturas locales de Aprobar y activar un rival (medios/RSS) y Comparación.
// Uso: node scripts/screenshots-30.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3130", out = "/workspace/pulso/screens"] = process.argv.slice(2);

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

await shot("/admin/rivales", "30-admin-rivales-desktop.png", desktop);
await shot("/admin/rivales", "30-kicillof-rivales-desktop.png", desktop, "#rivales-axel-kicillof");

{
  const { ctx, page, status } = await open("/admin/rivales", desktop);
  const card = page.locator("#rivales-axel-kicillof");
  const milei = card.locator("li").filter({ hasText: "Javier Milei" }).filter({ hasText: "Pendiente de alta" });
  await milei.getByRole("button", { name: "Aprobar" }).click();
  await page.getByText("Aprobado y activado: empieza a medirse en la próxima recolección", { exact: true }).waitFor({ timeout: 20000 });
  await card.screenshot({ path: `${out}/30-aprobar-activada-desktop.png` });
  console.log("30-aprobar-activada-desktop.png", page.url(), status);
  await ctx.close();
}

await shot("/c/axel-kicillof/comparacion", "30-comparacion-milei-desktop.png", desktop);
await shot("/c/axel-kicillof/comparacion", "30-comparacion-milei-mobile.png", mobile);

await browser.close();
