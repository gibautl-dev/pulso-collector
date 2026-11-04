// Capturas de pantalla de cada vista. Uso:
//   node scripts/screenshots.mjs <baseFixture> <baseLive> <outDir>
import { chromium } from "playwright";

const [fixture = "http://localhost:3100", live = "http://localhost:3101", out = "./screens"] = process.argv.slice(2);
const slug = "axel-kicillof";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "es-AR" });
const page = await ctx.newPage();

async function shot(url, file, fullPage = true) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/${file}`, fullPage });
  console.log(file, page.url());
}

await shot(`${live}/c/${slug}`, "01-login.png", false); // sin sesión redirige a /login
await shot(`${fixture}/c/${slug}`, "02-tablero.png");
await shot(`${fixture}/c/${slug}/menciones`, "03-menciones.png");
await shot(`${fixture}/c/${slug}/menciones?tone=negativas&target=candidate`, "04-menciones-filtradas.png");
// Detalle: primera crítica sobre el candidato
await page.goto(`${fixture}/c/${slug}/menciones?tone=negativas&target=candidate&relevance=alta`, { waitUntil: "networkidle" });
const href = await page.locator('ul a[href*="/menciones/"]').first().getAttribute("href");
await shot(`${fixture}${href}`, "05-detalle-mencion.png");
await shot(`${fixture}/c/${slug}/fuentes`, "06-salud-fuentes.png");
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-AR" });
const mp = await mobile.newPage();
await mp.goto(`${fixture}/c/${slug}`, { waitUntil: "networkidle" });
await mp.screenshot({ path: `${out}/07-tablero-mobile.png`, fullPage: true });
console.log("07-tablero-mobile.png");
await browser.close();
