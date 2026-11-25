// Interés en Wikipedia y atribución de GDELT (feat/new-sources).
// Uso: PULSO_FIXTURE_PATH=/workspace/pulso/fixture_overview_43.json npm run dev -- -p 3143
//      node scripts/screenshots-43.mjs <base> <outDir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:3143", out = "/workspace/pulso/screens"] = process.argv.slice(2);
const VIEW_W = 1440;

const browser = await chromium.launch();

async function open(path) {
  const ctx = await browser.newContext({
    locale: "es-AR",
    viewport: { width: VIEW_W, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120000 });
  if (!res || res.status() >= 400) {
    await ctx.close();
    throw new Error(`${path} status ${res?.status()}`);
  }
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function crop(page, file, locators, { hide = [], maxHeight = 920, pad = 8, extraBottom = 0, animations = "disabled" } = {}) {
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
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad + extraBottom;
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
  await page.screenshot({ path: `${out}/${file}`, clip, animations });
  console.log(file, `${clip.width}x${clip.height}`, "at", `${clip.x},${clip.y}`);
}

async function revealTip(button) {
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await button.hover();
  await button.evaluate((el) => {
    const root = el.parentElement;
    const bubble = root?.querySelector("[role=tooltip]");
    if (!bubble) return;
    bubble.style.opacity = "1";
    bubble.style.visibility = "visible";
    bubble.style.pointerEvents = "auto";
    bubble.classList.remove("invisible", "opacity-0");
  });
  await button.page().waitForTimeout(200);
}

const shots = [
  ["axel-kicillof", "kicillof"],
  ["milei", "milei"],
  ["pedro-sanchez", "sanchez"],
];

for (const [slug, name] of shots) {
  const { ctx, page } = await open(`/c/${slug}`);
  await crop(page, `43-tablero-kpis-wikipedia-${name}.png`, [
    "[data-testid=tablero-kpis]",
    "[data-testid=tablero-wikipedia]",
  ]);
  await crop(page, `43-tablero-wikipedia-${name}.png`, ["[data-testid=tablero-wikipedia]"]);
  const tip = page.locator("[data-testid=tablero-wikipedia] button[aria-label='Más información']").first();
  await revealTip(tip);
  await crop(
    page,
    `43-tablero-wikipedia-tip-${name}.png`,
    ["[data-testid=tablero-wikipedia]", "[data-testid=tablero-wikipedia] [role=tooltip]"],
    { extraBottom: 8, animations: "allow" },
  );
  await ctx.close();
}

{
  const { ctx, page } = await open(`/c/axel-kicillof/fuentes`);
  await crop(page, "43-fuentes-gdelt-kicillof.png", ["[data-testid=fuentes-gdelt]"]);
  const tip = page.locator("[data-testid=fuentes-gdelt] button[aria-label='Fuente']").first();
  await revealTip(tip);
  await crop(
    page,
    "43-fuentes-gdelt-kicillof-tip.png",
    ["[data-testid=fuentes-gdelt]", "[data-testid=fuentes-gdelt] [role=tooltip]"],
    { extraBottom: 8, animations: "allow" },
  );
  await ctx.close();
}

await browser.close();
