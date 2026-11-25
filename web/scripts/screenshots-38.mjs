// Alertas de contradicciones (feat/inconsistency-alerts).
// Uso: PULSO_FIXTURE_PATH=/workspace/pulso/fixture_inconsistency_38.json npm run dev -- -p 3138
//      node scripts/screenshots-38.mjs http://127.0.0.1:3138 /workspace/pulso/screens
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3138", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const browser = await chromium.launch();

async function open(path, width = 1440, height = 1000) {
  const ctx = await browser.newContext({ locale: "es-AR", viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180000 });
  if (!res || res.status() >= 400) throw new Error(`${path} status ${res?.status()}`);
  await page.waitForTimeout(400);
  return { ctx, page };
}

const full = async (page, file) => {
  await page.screenshot({ path: `${out}/${file}`, fullPage: true, animations: "disabled" });
  console.log(file);
};

for (const [slug, name] of [["axel-kicillof", "kicillof"], ["pedro-sanchez", "sanchez"], ["milei", "milei"]]) {
  const { ctx, page } = await open(`/c/${slug}/contradicciones`);
  await full(page, `38-contradicciones-${name}.png`);
  if (slug === "axel-kicillof") {
    const card = page.locator("[data-testid=contradiccion]").first();
    await card.screenshot({ path: `${out}/38-alerta-lado-a-lado-${name}.png`, animations: "disabled" });
    console.log(`38-alerta-lado-a-lado-${name}.png`);
    await page.locator("header button[aria-label='Cómo funciona']").first().hover().catch(async () => {
      await page.getByRole("button", { name: "Cómo funciona" }).first().hover();
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/38-tooltip-como-funciona.png`, clip: { x: 0, y: 0, width: 1440, height: 420 }, animations: "disabled" });
    console.log("38-tooltip-como-funciona.png");
    await card.locator("summary").click();
    await page.waitForTimeout(200);
    await card.screenshot({ path: `${out}/38-alerta-revision-${name}.png`, animations: "disabled" });
    console.log(`38-alerta-revision-${name}.png`);
  }
  await ctx.close();
}
{
  const { ctx, page } = await open(`/c/pedro-sanchez/contradicciones`, 390, 844);
  await full(page, `38-contradicciones-sanchez-movil.png`);
  await ctx.close();
}
await browser.close();
