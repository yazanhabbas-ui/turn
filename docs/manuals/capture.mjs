// Takes the screenshots the manuals use, from a running copy of the app with the demo data.
//
//   npm run local                                   # in another terminal (demo data, http://localhost:3000)
//   node docs/manuals/capture.mjs                   # every screenshot, Arabic and English
//   node docs/manuals/capture.mjs --only=agent-     # only names starting with this
//
// Reads docs/manuals/src/shots/*.json, writes docs/manuals/shots/<name>.<lang>.png.
// Environment: APP_URL (default http://localhost:3000), DEMO_PASSWORD (the demo accounts' password, see README).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPECS = path.join(HERE, "src", "shots");
const OUT = path.join(HERE, "shots");
const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_PASSWORD ?? "Dor@Demo2026";
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

const specs = new Map();
for (const f of fs.readdirSync(SPECS).filter((f) => f.endsWith(".json"))) {
  for (const s of JSON.parse(fs.readFileSync(path.join(SPECS, f), "utf8"))) if (!specs.has(s.name)) specs.set(s.name, s);
}
const list = [...specs.values()].filter((s) => !only || s.name.startsWith(only));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const failures = [];
try {
  for (const lang of ["ar", "en"]) {
    const byUser = Map.groupBy(list, (s) => s.user || "");
    for (const [user, shots] of byUser) {
      const ctx = await browser.newContext({
        locale: lang === "ar" ? "ar-SA" : "en-GB",
        colorScheme: "light",
        viewport: { width: 1366, height: 860 },
      });
      try {
        if (user) {
          const res = await ctx.request.post(`${BASE}/api/v1/auth/login`, {
            data: { email: user, password: PASSWORD },
            headers: { origin: BASE },
          });
          if (!res.ok()) throw new Error(`login ${user}: ${res.status()}`);
        }
        const page = await ctx.newPage();
        for (const s of shots) {
          try {
            const url = `${BASE}${lang === "en" ? "/en" : ""}${s.path === "/" ? "" : s.path}`;
            await page.goto(url, { waitUntil: "domcontentloaded" });
            await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
            if (s.waitFor) await page.waitForSelector(s.waitFor, { timeout: 8000 }).catch(() => undefined);
            // Optional: open a tab first. `click` is the tab's label, per language: {"en": "Voice", "ar": "الصوت"}.
            if (s.click?.[lang]) {
              await page.getByRole("tab", { name: s.click[lang] }).first().click();
              await page.waitForTimeout(700);
            }
            await page.waitForTimeout(900);
            await page.screenshot({ path: path.join(OUT, `${s.name}.${lang}.png`), fullPage: !!s.fullPage });
            console.log(`ok   ${s.name}.${lang}`);
          } catch (e) {
            failures.push(`${s.name}.${lang}: ${e.message}`);
            console.log(`FAIL ${s.name}.${lang}: ${e.message}`);
          }
        }
      } catch (e) {
        for (const s of shots) failures.push(`${s.name}.${lang}: ${e.message}`);
        console.log(`FAIL user ${user} (${lang}): ${e.message}`);
      } finally {
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} screenshot(s) failed`);
  process.exitCode = 1;
}
