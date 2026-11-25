// Capturas del panel Gasto (modo fixture con datos reales exportados en solo lectura).
//   node scripts/screenshots-42.mjs http://localhost:3142 /workspace/pulso/screens
import { chromium } from "playwright";

const [base = "http://localhost:3142", out = "./screens"] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "es-AR" });
const page = await ctx.newPage();
await page.goto(`${base}/admin/gasto`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/42-gasto-completo.png`, fullPage: true });
await page.screenshot({ path: `${out}/42-gasto-arriba.png`, fullPage: false });
for (const [title, file] of [["Por función", "42-gasto-por-funcion.png"], ["API de X por día", "42-gasto-x.png"]]) {
  const card = page.locator("section", { has: page.locator("h2", { hasText: title }) }).first();
  await card.screenshot({ path: `${out}/${file}` });
}
const cap = page.locator('[data-testid="ai-cap-form"]').locator("xpath=..");
await cap.screenshot({ path: `${out}/42-gasto-tope-ia.png` });
const infra = page.locator("section", { has: page.locator("h2", { hasText: "Infraestructura" }) }).first();
await infra.screenshot({ path: `${out}/42-gasto-infra.png` });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-AR" });
const mp = await mobile.newPage();
await mp.goto(`${base}/admin/gasto`, { waitUntil: "networkidle" });
await mp.screenshot({ path: `${out}/42-gasto-mobile.png`, fullPage: true });
// Aviso al cliente cuando se alcanzó el tope (otro servidor local con ai_visibility_cap_reached_today).
const iaBase = process.argv[4];
if (iaBase) {
  const ip = await ctx.newPage();
  await ip.goto(`${iaBase}/c/axel-kicillof/ia`, { waitUntil: "networkidle" });
  await ip.screenshot({ path: `${out}/42-ia-tope-alcanzado.png`, fullPage: false });
}
await browser.close();
console.log("ok");
