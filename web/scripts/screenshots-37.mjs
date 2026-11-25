// Variación con cobertura y pauta de rivales no medida (fix/rival-common-window).
// Uso: node scripts/screenshots-37.mjs <base-nuevo> <base-antes> <outDir>
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

async function shot(page, file, locator, extraBottom = 0) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const clip = { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 + extraBottom };
  await page.screenshot({ path: `${out}/${file}`, clip, animations: "disabled" });
  console.log(file);
}

for (const [root, tag] of [[before, "37-antes-"], [base, "37-"]]) {
  for (const [slug, name] of [["axel-kicillof", "kicillof"], ["milei", "milei"]]) {
    const { ctx, page } = await open(root, `/c/${slug}`);
    const kpis = page.locator("[data-testid=tablero-kpis]");
    await shot(page, `${tag}tablero-kpis-${name}.png`, kpis);
    if (tag === "37-" && slug === "axel-kicillof") {
      await kpis.locator("button").first().hover();
      await page.waitForTimeout(300);
      await shot(page, `37-tablero-kpis-tooltip-${name}.png`, kpis, 110);
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await open(root, `/c/axel-kicillof/temas`);
    await shot(page, `${tag}temas-tendencia-kicillof.png`, page.locator("section").filter({ hasText: "Volumen" }).first());
    await ctx.close();
  }
  {
    const { ctx, page } = await open(root, `/c/axel-kicillof/comparacion`);
    const head = page.locator("p").filter({ hasText: "Frente a" }).first().locator("xpath=..");
    await head.screenshot({ path: `${out}/${tag}rivales-par-anuncios-kicillof-milei.png`, animations: "disabled" });
    console.log(`${tag}rivales-par-anuncios-kicillof-milei.png`);
    await ctx.close();
  }
}
await browser.close();
