// Simulador de respuesta (feat/response-simulator), modo fixture.
// Uso: node scripts/screenshots-39.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3139", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const SIMS = {
  "axel-kicillof": ["kicillof", "39a1c0de-0000-4000-8000-00000000a001"],
  "pedro-sanchez": ["sanchez", "39a1c0de-0000-4000-8000-00000000b001"],
};
const browser = await chromium.launch();

async function open(path, width = 1440, height = 900) {
  const ctx = await browser.newContext({ locale: "es-AR", viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180000 });
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

for (const [slug, [name, id]] of Object.entries(SIMS)) {
  const { ctx, page } = await open(`/c/${slug}/simulador?sim=${id}`);
  await page.screenshot({ path: `${out}/39-${name}-pagina.png`, fullPage: true, animations: "disabled" });
  console.log(`39-${name}-pagina.png`);
  await shot(page, `39-${name}-borrador.png`, page.locator("main").locator("div.grid").first());
  const result = page.locator("[data-testid=simulador-resultado]");
  await shot(page, `39-${name}-riesgo.png`, result.locator("[data-testid=simulador-riesgo]"));
  await shot(page, `39-${name}-temas.png`, result.locator("[data-testid=simulador-temas]"));
  for (const key of ["simpatizantes", "criticos", "medios", "rival"]) {
    const card = result.locator(`[data-testid=simulador-publico-${key}]`);
    if ((await card.count()) === 0) continue;
    await shot(page, `39-${name}-publico-${key}.png`, card);
  }
  await shot(page, `39-${name}-version.png`, result.locator("[data-testid=simulador-version]"));
  if (slug === "axel-kicillof") {
    const tip = result.locator("[data-testid=simulador-riesgo] button").first();
    await tip.hover();
    await page.waitForTimeout(300);
    await shot(page, `39-${name}-estimacion-tooltip.png`, result.locator("[data-testid=simulador-riesgo]"), 40);
  }
  await ctx.close();
}
{
  const { ctx, page } = await open(`/c/axel-kicillof/simulador`);
  await shot(page, `39-kicillof-nuevo.png`, page.locator("main").locator("div.grid").first());
  await shot(page, `39-menu.png`, page.locator("nav").first());
  await ctx.close();
}
await browser.close();
