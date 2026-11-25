// Comparación con ventana común (fix/rival-common-window) sobre el fixture de solo lectura.
// Uso: node scripts/screenshots-36.mjs <base-nuevo> <base-antes> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3136", before = "http://127.0.0.1:3137", out = "/workspace/pulso/screens"] =
  process.argv.slice(2);
const browser = await chromium.launch();

async function open(root, path, width = 1440, height = 900) {
  const ctx = await browser.newContext({ locale: "es-AR", viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const res = await page.goto(`${root}${path}`, { waitUntil: "networkidle", timeout: 180000 });
  if (!res || res.status() >= 400) throw new Error(`${path} status ${res?.status()}`);
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function shot(page, file, locator, { pad = 8, extraBottom = 0 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const clip = {
    x: Math.max(0, Math.floor(b.x - pad)),
    y: Math.max(0, Math.floor(b.y - pad)),
    width: Math.ceil(b.width + 2 * pad),
    height: Math.ceil(b.height + 2 * pad + extraBottom),
  };
  await page.screenshot({ path: `${out}/${file}`, clip, animations: "disabled" });
  console.log(file, `${clip.width}x${clip.height}`);
}

const k = "axel-kicillof";
const cardSel = (page) =>
  page.locator("[data-testid=tablero-spotlights] section").filter({ hasText: "Comparación con rivales" }).first();

{
  const { ctx, page } = await open(before, `/c/${k}`);
  await shot(page, "36-antes-tablero-comparacion-kicillof.png", cardSel(page));
  await ctx.close();
}
{
  const { ctx, page } = await open(base, `/c/${k}`);
  await shot(page, "36-tablero-comparacion-kicillof.png", cardSel(page));
  await page.locator("[data-testid=comparacion-periodo] button").hover();
  await page.waitForTimeout(300);
  await shot(page, "36-tablero-comparacion-tooltip-kicillof.png", cardSel(page), { extraBottom: 120 });
  await ctx.close();
}
{
  const { ctx, page } = await open(before, `/c/${k}/comparacion`);
  await shot(page, "36-antes-rivales-quien-domina-kicillof.png", page.locator("section").filter({ hasText: "Quién domina la conversación" }).first());
  await ctx.close();
}
{
  const { ctx, page } = await open(base, `/c/${k}/comparacion`);
  const sov = page.locator("[data-testid=rivales-quien-domina]");
  await shot(page, "36-rivales-quien-domina-kicillof.png", sov);
  const pair = page.locator("[data-testid=rivales-par]");
  await pair.scrollIntoViewIfNeeded();
  await pair.screenshot({ path: `${out}/36-rivales-par-kicillof-milei.png`, animations: "disabled" });
  console.log("36-rivales-par-kicillof-milei.png");
  await ctx.close();
}
{
  const { ctx, page } = await open(before, `/c/${k}/comparacion`);
  await page.locator("p").filter({ hasText: "Frente a" }).first().locator("xpath=..").screenshot({
    path: `${out}/36-antes-rivales-par-kicillof-milei.png`,
    animations: "disabled",
  });
  console.log("36-antes-rivales-par-kicillof-milei.png");
  await ctx.close();
}
{
  const { ctx, page } = await open(base, `/c/${k}`, 390, 844);
  await shot(page, "36-tablero-comparacion-mobile-kicillof.png", cardSel(page), { pad: 0 });
  await ctx.close();
}
await browser.close();
