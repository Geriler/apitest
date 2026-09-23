// Дымовой тест в настоящем браузере: собранная страница открывается в Chromium,
// проверяются ошибки в консоли, пример схемы и установка детали мышью.
// Запуск: npm run build && node scripts/smoke.mjs [--chrome /path/to/chrome]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const chromePath = args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : process.env.CHROME_PATH;
const port = 4179;
mkdirSync("screenshots", { recursive: true });

// vite запускается напрямую и в своей группе процессов, чтобы в конце завершить его целиком
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(port), "--strictPort"], {
  stdio: "pipe",
  detached: true,
});
let serverLog = "";
server.stderr.on("data", (d) => (serverLog += d));
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => String(d).includes(String(port)) && resolve());
  server.on("exit", (code) => reject(new Error(`vite preview завершился с кодом ${code}: ${serverLog}`)));
});
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* уже завершён */
  }
};

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

try {
  for (const viewport of [{ width: 1400, height: 860, name: "desktop" }, { width: 400, height: 820, name: "phone" }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    // «Failed to load resource» дублирует requestfailed/response ниже, там есть адрес
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    // Сбои загрузки с адресами. Шрифты Google — внешние: их сбой не ломает страницу
    // (есть запасные шрифты), поэтому это предупреждение, а не ошибка.
    const external = (url) => /fonts\.(googleapis|gstatic)\.com/.test(url);
    page.on("requestfailed", (r) => (external(r.url()) ? console.log(`warn ${r.url()} — ${r.failure()?.errorText}`) : errors.push(`${r.url()} — ${r.failure()?.errorText}`)));
    page.on("response", (r) => r.status() >= 400 && !external(r.url()) && errors.push(`${r.status()} ${r.url()}`));
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.maketka, null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `screenshots/${viewport.name}-demo.png` });

    const app = await page.evaluate(() => {
      const a = window.maketka;
      return {
        components: a.scene.components.length,
        hl1: a.sim.overload(a.component("HL1")),
        r1: a.sim.overload(a.component("R1")),
      };
    });
    check(app.components === 7, `${viewport.name}: в примере 7 деталей`);
    check(app.hl1 > 0.9 && app.hl1 < 1.3, `${viewport.name}: HL1 горит (${app.hl1.toFixed(2)} от номинала)`);
    check(app.r1 < 1, `${viewport.name}: R1 не перегружен (${app.r1.toFixed(2)})`);
    const hintVisible = await page.isVisible("#hint");
    check(!hintVisible, `${viewport.name}: в режиме выбора подсказки нет`);
    const horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!horizontalScroll, `${viewport.name}: нет горизонтальной прокрутки`);

    if (viewport.name === "desktop") {
      // Замкнуть SA2 двумя нажатиями мышью: выбрать и переключить
      const sa2 = await page.evaluate(() => {
        const a = window.maketka;
        const p = a.views.get("SA2").hotspot.clone();
        p.y -= 1.2;
        const s = a.world.toScreen(p);
        return { x: s.x, y: s.y };
      });
      await page.mouse.click(sa2.x, sa2.y);
      await page.waitForTimeout(150);
      await page.mouse.click(sa2.x, sa2.y);
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() => window.maketka.component("SA2").closed);
      check(closed, "мышью: SA2 замкнут двумя нажатиями");
      await page.waitForTimeout(1200);
      await page.screenshot({ path: "screenshots/desktop-smoke.png" });
      await page.waitForTimeout(3500);
      const burned = await page.evaluate(() => window.maketka.sim.state("R2").burned);
      check(burned, "R2 22 Ом сгорел после замыкания SA2");
      await page.screenshot({ path: "screenshots/desktop-burned.png" });

      // Поставить выводной резистор мышью между f12 и f16
      await page.keyboard.press("3");
      const holes = await page.evaluate(() => {
        const a = window.maketka;
        return ["f12", "f16"].map((id) => {
          const s = a.world.toScreen(a.endpointPos({ hole: id }));
          return { x: s.x, y: s.y };
        });
      });
      const before = await page.evaluate(() => window.maketka.scene.components.length);
      await page.mouse.move(holes[0].x, holes[0].y);
      await page.mouse.click(holes[0].x, holes[0].y);
      await page.mouse.move(holes[1].x, holes[1].y);
      await page.mouse.click(holes[1].x, holes[1].y);
      await page.waitForTimeout(300);
      const placed = await page.evaluate(() => {
        const a = window.maketka;
        const c = a.scene.components.at(-1);
        return { count: a.scene.components.length, holes: c.placement.holes };
      });
      check(placed.count === before + 1 && placed.holes?.join() === "f12,f16", `мышью: резистор встал в ${placed.holes?.join(" и ")}`);

      // Батарея на плату не ставится
      await page.keyboard.press("6");
      const h = await page.evaluate(() => {
        const s = window.maketka.world.toScreen(window.maketka.endpointPos({ hole: "h5" }));
        return { x: s.x, y: s.y };
      });
      await page.mouse.move(h.x, h.y);
      await page.mouse.click(h.x, h.y);
      const hint = await page.textContent("#hint");
      check(/ставится на стол/.test(hint ?? ""), "батарея на макетку: показана подсказка");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.screenshot({ path: "screenshots/desktop-final.png" });
    }

    check(errors.length === 0, `${viewport.name}: нет ошибок в консоли${errors.length ? ": " + errors.join(" | ") : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
  stopServer();
}

if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
