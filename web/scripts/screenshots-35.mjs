// Resumen del día (feat/daily-brief) sobre el fixture con resúmenes de ejemplo.
// Uso: node scripts/screenshots-35.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3135", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const browser = await chromium.launch();

async function open(path, width = 1440, height = 900) {
  const ctx = await browser.newContext({ locale: "es-AR", viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120000 });
  if (!res || res.status() >= 400) throw new Error(`${path} status ${res?.status()}`);
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function crop(page, file, selectors, { pad = 8, maxHeight = 1400 } = {}) {
  const width = page.viewportSize().width;
  const boxes = [];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    await loc.waitFor({ state: "attached", timeout: 20000 });
    boxes.push(await loc.boundingBox());
  }
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  const height = Math.min(maxHeight, Math.ceil(bottom - y));
  if (page.viewportSize().height < y + height + 16) {
    await page.setViewportSize({ width, height: Math.ceil(y + height + 16) });
    await page.waitForTimeout(150);
  }
  const clip = { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(right - x), height };
  await page.screenshot({ path: `${out}/${file}`, clip, animations: "disabled" });
  console.log(file, `${clip.width}x${clip.height}`);
}

const k = "axel-kicillof";
const s = "pedro-sanchez";

{
  const { ctx, page } = await open(`/c/${k}/resumen`);
  await crop(page, "35-resumen-hero-kicillof.png", ["main h1", "[data-testid=resumen-hero]"]);
  await crop(page, "35-resumen-secciones-kicillof.png", ["[data-testid=resumen-secciones]"]);
  await crop(page, "35-resumen-fuentes-kicillof.png", ["[data-testid=resumen-fuentes]"], { maxHeight: 900 });
  await ctx.close();
}
{
  const { ctx, page } = await open(`/c/${k}`);
  await crop(page, "35-tablero-resumen-kicillof.png", ["main h1", "[data-testid=tablero-resumen]", "[data-testid=tablero-kpis]"]);
  await ctx.close();
}
{
  const { ctx, page } = await open(`/c/${s}/resumen`);
  await crop(page, "35-resumen-hero-sanchez.png", ["main h1", "[data-testid=resumen-hero]"]);
  await crop(page, "35-resumen-secciones-sanchez.png", ["[data-testid=resumen-secciones]"]);
  await ctx.close();
}
for (const [slug, name] of [[k, "kicillof"], [s, "sanchez"]]) {
  const { ctx, page } = await open(`/c/${slug}/resumen`, 390, 844);
  await crop(page, `35-resumen-mobile-${name}.png`, ["main h1", "[data-testid=resumen-hero]", "[data-testid=resumen-que-cambio]"], { pad: 0, maxHeight: 2600 });
  await crop(page, `35-resumen-mobile-que-hacer-${name}.png`, ["[data-testid=resumen-que-hacer]"], { pad: 0, maxHeight: 2000 });
  await ctx.close();
}
await browser.close();
