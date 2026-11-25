// Asistente de datos (feat/data-assistant). Fixture con respuestas de ejemplo.
// Uso: node scripts/screenshots-40.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3140", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const browser = await chromium.launch();

async function open(path, width = 1440, height = 1000) {
  const ctx = await browser.newContext({ locale: "es-AR", viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180000 });
  if (!res || res.status() >= 400) throw new Error(`${path} status ${res?.status()}`);
  await page.waitForTimeout(500);
  return { ctx, page };
}

async function el(page, file, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: `${out}/${file}`, animations: "disabled" });
  console.log(file);
}

for (const [slug, name] of [["axel-kicillof", "kicillof"], ["pedro-sanchez", "sanchez"]]) {
  // Cada respuesta, recortada.
  const { ctx, page } = await open(`/c/${slug}/asistente`, 1200, 1400);
  const turns = page.locator("main [data-testid=assistant-turn]");
  const n = await turns.count();
  for (let i = 0; i < n; i++) {
    await el(page, `40-${name}-respuesta-${i + 1}.png`, turns.nth(i));
  }
  // Página completa (arriba).
  await page.evaluate(() => document.querySelector("main [data-testid=assistant-turn]")?.parentElement?.scrollTo(0, 0));
  await page.screenshot({ path: `${out}/40-${name}-pagina.png`, animations: "disabled" });
  console.log(`40-${name}-pagina.png`);
  await ctx.close();
}

// Botón flotante y panel lateral sobre el tablero.
{
  const { ctx, page } = await open(`/c/axel-kicillof`, 1440, 1000);
  await el(page, "40-kicillof-boton-flotante.png", page.locator("[data-testid=assistant-open]"));
  await page.locator("[data-testid=assistant-open]").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/40-kicillof-panel-lateral.png`, animations: "disabled" });
  console.log("40-kicillof-panel-lateral.png");
  await ctx.close();
}

// ⓘ con "Preguntale a Pulso sobre esto".
{
  const { ctx, page } = await open(`/c/axel-kicillof`, 1440, 1000);
  const tip = page.locator("main [data-testid=ask-from-info]").first();
  const wrapper = tip.locator("xpath=ancestor::span[contains(@class,'group/tip')][1]");
  await wrapper.scrollIntoViewIfNeeded();
  await wrapper.locator("button").first().hover();
  await page.waitForTimeout(400);
  const card = wrapper.locator("xpath=ancestor::*[contains(@class,'rounded-xl') or self::section][1]");
  const b = await card.boundingBox();
  const t = await tip.locator("xpath=..").boundingBox();
  const x = Math.min(b.x, t.x) - 12;
  const y = b.y - 12;
  const right = Math.max(b.x + b.width, t.x + t.width) + 12;
  const bottom = Math.max(b.y + b.height, t.y + t.height) + 12;
  await page.screenshot({ path: `${out}/40-kicillof-info-preguntar.png`, clip: { x, y, width: right - x, height: bottom - y }, animations: "disabled" });
  console.log("40-kicillof-info-preguntar.png");
  // Click: abre el panel con la pregunta de esa tarjeta (sin modelo en esta máquina: muestra el aviso de no disponible).
  await tip.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/40-kicillof-info-abre-panel.png`, animations: "disabled" });
  console.log("40-kicillof-info-abre-panel.png");
  await ctx.close();
}

// Sánchez: estado inicial con sugerencias (panel lateral sin historial no aplica: se muestra la página de Temas).
{
  const { ctx, page } = await open(`/c/pedro-sanchez/temas`, 1440, 1000);
  await page.locator("[data-testid=assistant-open]").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/40-sanchez-panel-lateral-temas.png`, animations: "disabled" });
  console.log("40-sanchez-panel-lateral-temas.png");
  await ctx.close();
}
await browser.close();
