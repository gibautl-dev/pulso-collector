// Capturas locales (fixture) de briefs etiquetados, comparación y panel admin.
// Uso: node scripts/screenshots-24.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3124", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const kici = "axel-kicillof";
const pedro = "pedro-sanchez";
const kiciBrief = "0f96c59f-8c93-4fe0-b6de-78b77cb38fdb";
const pedroBrief = "c1000000-0000-4000-8000-000000000001";

const browser = await chromium.launch();

async function shot(contextOpts, url, file) {
  const ctx = await browser.newContext({ locale: "es-AR", ...contextOpts });
  const page = await ctx.newPage();
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) {
    throw new Error(`${file}: ${url} status ${res?.status()}`);
  }
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  console.log(file, page.url(), res.status());
  await ctx.close();
}

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

await shot(desktop, `${base}/c/${kici}/accion/${kiciBrief}`, "24-kicillof-brief-desktop.png");
await shot(mobile, `${base}/c/${kici}/accion/${kiciBrief}`, "24-kicillof-brief-mobile.png");
await shot(desktop, `${base}/c/${pedro}/accion/${pedroBrief}`, "24-sanchez-brief-desktop.png");
await shot(mobile, `${base}/c/${pedro}/accion/${pedroBrief}`, "24-sanchez-brief-mobile.png");
await shot(desktop, `${base}/c/${kici}/comparacion`, "24-kicillof-comparacion-desktop.png");
await shot(mobile, `${base}/c/${kici}/comparacion`, "24-kicillof-comparacion-mobile.png");
await shot(desktop, `${base}/c/${pedro}/comparacion`, "24-sanchez-comparacion-desktop.png");
await shot(mobile, `${base}/c/${pedro}/comparacion`, "24-sanchez-comparacion-mobile.png");
await shot(desktop, `${base}/admin/rivales`, "24-admin-rivales-desktop.png");
await shot(mobile, `${base}/admin/rivales`, "24-admin-rivales-mobile.png");

await browser.close();
