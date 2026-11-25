// Capturas locales: Equipo de acción, temas a medida y panel staff.
// Uso: node scripts/screenshots-26.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3126", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const kici = "axel-kicillof";
const pedro = "pedro-sanchez";
const kiciTema = "ct-kici-educacion";
const pedroTema = "ct-pedro-vivienda";

const browser = await chromium.launch();

async function shot(contextOpts, url, file, maybeSelector) {
  const ctx = await browser.newContext({ locale: "es-AR", ...contextOpts });
  const page = await ctx.newPage();
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${file}: ${url} status ${res?.status()}`);
  }
  if (maybeSelector) {
    const loc = page.locator(maybeSelector);
    await loc.waitFor({ state: "visible", timeout: 15000 });
    await loc.screenshot({ path: `${out}/${file}` });
  } else {
    await page.screenshot({ path: `${out}/${file}`, fullPage: true });
  }
  console.log(file, page.url(), res.status());
  await ctx.close();
}

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

for (const [vp, suffix] of [[desktop, "desktop"], [mobile, "mobile"]]) {
  await shot(vp, `${base}/c/${kici}`, `26-kicillof-tablero-${suffix}.png`);
  await shot(vp, `${base}/c/${pedro}`, `26-sanchez-tablero-${suffix}.png`);
  await shot(vp, `${base}/c/${kici}/accion`, `26-kicillof-equipo-accion-${suffix}.png`);
  await shot(vp, `${base}/c/${pedro}/accion`, `26-sanchez-equipo-accion-${suffix}.png`);
  await shot(vp, `${base}/c/${kici}/temas`, `26-kicillof-temas-${suffix}.png`);
  await shot(vp, `${base}/c/${pedro}/temas`, `26-sanchez-temas-${suffix}.png`);
  await shot(vp, `${base}/c/${kici}/temas/${kiciTema}`, `26-kicillof-tema-detalle-${suffix}.png`);
  await shot(vp, `${base}/c/${pedro}/temas/${pedroTema}`, `26-sanchez-tema-detalle-${suffix}.png`);
  await shot(vp, `${base}/admin/temas`, `26-admin-temas-${suffix}.png`);
}

await browser.close();
