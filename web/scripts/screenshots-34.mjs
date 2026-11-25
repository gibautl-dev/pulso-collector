// Recortes ajustados y legibles (PP-11 polish) sobre el fixture actualizado.
// Uso: node scripts/screenshots-33.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3133", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const VIEW_W = 1440;

const browser = await chromium.launch();

async function open(path) {
  const ctx = await browser.newContext({
    locale: "es-AR",
    viewport: { width: VIEW_W, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 90000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${path} status ${res?.status()}`);
  }
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function crop(page, file, locators, { hide = [], maxHeight = 920, pad = 8 } = {}) {
  for (const sel of hide) {
    for (const el of await page.locator(sel).all()) {
      await el.evaluate((node) => {
        node.style.display = "none";
      });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const boxes = [];
  for (const sel of locators) {
    const loc = page.locator(sel).first();
    await loc.waitFor({ state: "attached", timeout: 20000 });
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`no box for ${sel}`);
    boxes.push(box);
  }
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(VIEW_W, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  const height = Math.min(maxHeight, Math.ceil(bottom - y));
  const needed = Math.ceil(y + height + 16);
  const current = page.viewportSize();
  if (!current || current.height < needed) {
    await page.setViewportSize({ width: VIEW_W, height: needed });
    await page.waitForTimeout(100);
  }
  const clip = {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.max(1, Math.ceil(right - x)),
    height: Math.max(1, height),
  };
  await page.screenshot({ path: `${out}/${file}`, clip, animations: "disabled" });
  console.log(file, `${clip.width}x${clip.height}`, "at", `${clip.x},${clip.y}`);
}

const k = "axel-kicillof";
const s = "pedro-sanchez";

{
  const { ctx, page } = await open(`/c/${k}`);
  await crop(page, "34-tablero-top-kicillof.png", ["[data-testid=tablero-kpis]", "[data-testid=tablero-volume-tone]"], {
    hide: ["[data-testid=tablero-source-cards]"],
  });
  await crop(page, "34-menciones-kicillof.png", ["[data-testid=ultimas-menciones]"]);
  await crop(page, "34-tablero-cards-kicillof.png", ["[data-testid=tablero-spotlights]"]);
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/${k}/comparacion`);
  await crop(page, "34-rivales-kicillof.png", ["[data-testid=rivales-hero]"], { maxHeight: 920 });
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/${k}/sospechosas`);
  await crop(page, "34-sospechosas-kicillof.png", ["[data-testid=sospechosas-hero]"]);
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/${k}/ia`);
  await crop(page, "34-ia-kicillof.png", ["[data-testid=ia-hero]"]);
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/${k}/temas`);
  const card = page.locator("[data-testid=temas-list] section").first();
  if ((await card.count()) > 0) {
    await crop(page, "34-temas-kicillof.png", ["[data-testid=temas-list] section"]);
  } else {
    await crop(page, "34-temas-kicillof.png", ["main"]);
  }
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/${s}`);
  await crop(page, "34-tablero-top-sanchez.png", ["[data-testid=tablero-kpis]", "[data-testid=tablero-volume-tone]"], {
    hide: ["[data-testid=tablero-source-cards]"],
  });
  await crop(page, "34-tablero-cards-sanchez.png", ["[data-testid=tablero-spotlights]"]);
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/${s}/ia`);
  await crop(page, "34-ia-sanchez.png", ["[data-testid=ia-hero]"]);
  await ctx.close();
}

await browser.close();
