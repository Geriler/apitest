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
    // Режим допусков: включить, другие экземпляры, выключить — номинал возвращается
    const hlI = () => page.evaluate(() => window.maketka.sim.current(window.maketka.component("HL1")));
    const nominalI = await hlI();
    await page.click("#btn-tol");
    const realI = await hlI();
    const rerollShown = await page.isVisible("#btn-reroll");
    await page.click("#btn-reroll");
    const otherI = await hlI();
    await page.screenshot({ path: `screenshots/${viewport.name}-tolerance.png` });
    await page.click("#btn-tol");
    const backI = await hlI();
    check(
      realI !== nominalI && otherI !== realI && backI === nominalI && rerollShown && !(await page.isVisible("#btn-reroll")),
      `${viewport.name}: допуски ${(nominalI * 1000).toFixed(1)} → ${(realI * 1000).toFixed(1)} → ${(otherI * 1000).toFixed(1)} → ${(backI * 1000).toFixed(1)} мА`,
    );
    const actionsBottom = await page.evaluate(() => document.getElementById("actions").getBoundingClientRect().bottom);
    const toastsTop = await page.evaluate(() => document.getElementById("toasts").getBoundingClientRect().top);
    check(viewport.name === "desktop" || toastsTop >= actionsBottom, `${viewport.name}: уведомления не наезжают на кнопки (${Math.round(toastsTop)} ≥ ${Math.round(actionsBottom)})`);
    const hintVisible = await page.isVisible("#hint");
    check(!hintVisible, `${viewport.name}: в режиме выбора подсказки нет`);
    const horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!horizontalScroll, `${viewport.name}: нет горизонтальной прокрутки`);

    if (viewport.name === "desktop") {
      // Панель детали — только по щелчку, не при наведении
      const r1 = await page.evaluate(() => {
        const s = window.maketka.world.toScreen(window.maketka.views.get("R1").hotspot);
        return { x: s.x, y: s.y };
      });
      await page.mouse.move(r1.x, r1.y);
      await page.waitForTimeout(400);
      check(!/Резистор 3,3 Ом/.test(await page.textContent("#inspector")), "наведение на R1 не открывает его панель");
      await page.mouse.click(r1.x, r1.y);
      await page.waitForTimeout(400);
      check(/Резистор 3,3 Ом/.test(await page.textContent("#inspector")), "щелчок по R1 открывает его панель");
      await page.keyboard.press("Escape");

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
      await page.keyboard.press("9");
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

      // Пример 2: конденсатор и светодиоды
      await page.selectOption("#demo-select", "leds");
      await page.waitForTimeout(2500);
      await page.screenshot({ path: "screenshots/desktop-leds.png" });
      const leds = await page.evaluate(() => {
        const a = window.maketka;
        const i = (id) => a.sim.current(a.component(id));
        return { hl1: i("HL1"), hl2: i("HL2"), hl3: i("HL3") };
      });
      check(leds.hl1 > 0.005 && leds.hl2 > 0.01, `светодиоды HL1, HL2 горят (${(leds.hl1 * 1000).toFixed(1)} и ${(leds.hl2 * 1000).toFixed(1)} мА)`);
      check(Math.abs(leds.hl3) < 1e-6, "перевёрнутый HL3 не горит");
      const hl3 = await page.evaluate(() => {
        const s = window.maketka.world.toScreen(window.maketka.views.get("HL3").hotspot);
        return { x: s.x, y: s.y + 4 };
      });
      await page.mouse.click(hl3.x, hl3.y);
      await page.waitForTimeout(300);
      const selected = await page.evaluate(() => window.maketka.selected);
      await page.keyboard.press("f");
      await page.waitForTimeout(400);
      const hl3After = await page.evaluate(() => window.maketka.sim.current(window.maketka.component("HL3")));
      check(selected === "HL3" && hl3After > 0.01, `мышью: HL3 выбран (${selected}) и после F горит (${(hl3After * 1000).toFixed(1)} мА)`);

      // Разомкнуть SA1: HL1 гаснет не сразу
      await page.evaluate(() => {
        const a = window.maketka;
        a.component("SA1").closed = false;
        a.changed();
      });
      await page.waitForTimeout(1000);
      const fading = await page.evaluate(() => window.maketka.sim.current(window.maketka.component("HL1")));
      check(fading > 0.003, `после размыкания SA1 HL1 ещё светится через 1 с (${(fading * 1000).toFixed(1)} мА)`);
      await page.screenshot({ path: "screenshots/desktop-fading.png" });

      // Цвет провода: выбрать синий и проложить провод
      await page.keyboard.press("Escape");
      await page.keyboard.press("2");
      await page.click('#inspector .swatch[data-color="#2f6fd1"]');
      const ends = await page.evaluate(() => {
        const a = window.maketka;
        return ["f2", "f6"].map((id) => {
          const s = a.world.toScreen(a.endpointPos({ hole: id }));
          return { x: s.x, y: s.y };
        });
      });
      for (const e of ends) {
        await page.mouse.move(e.x, e.y);
        await page.mouse.click(e.x, e.y);
      }
      await page.waitForTimeout(300);
      const wire = await page.evaluate(() => window.maketka.scene.wires.at(-1));
      check(wire.color === "#2f6fd1" && "hole" in wire.a && wire.a.hole === "f2", `провод выбранного цвета: ${wire.color} ${JSON.stringify(wire.a)}`);

      // Пример 3: мигалка на транзисторах
      await page.keyboard.press("Escape");
      await page.keyboard.press("1");
      await page.selectOption("#demo-select", "blinker");
      const seen = { hl1: false, hl2: false, hl1Only: false, hl2Only: false };
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(250);
        const cur = await page.evaluate(() => {
          const a = window.maketka;
          return [a.sim.current(a.component("HL1")), a.sim.current(a.component("HL2"))];
        });
        const on1 = cur[0] > 0.005, on2 = cur[1] > 0.005;
        seen.hl1 ||= on1;
        seen.hl2 ||= on2;
        seen.hl1Only ||= on1 && !on2;
        seen.hl2Only ||= on2 && !on1;
        if (i === 6) await page.screenshot({ path: "screenshots/desktop-blinker.png" });
      }
      check(seen.hl1Only && seen.hl2Only, `мигалка: светодиоды горят по очереди ${JSON.stringify(seen)}`);
      const vt1 = await page.evaluate(() => {
        const s = window.maketka.world.toScreen(window.maketka.views.get("VT1").hotspot);
        return { x: s.x, y: s.y + 6 };
      });
      await page.mouse.click(vt1.x, vt1.y);
      await page.waitForTimeout(400);
      const panel = await page.textContent("#inspector");
      check(/BC547B/.test(panel ?? "") && /I(К|к)/.test(panel ?? ""), "щелчок по VT1: панель транзистора с токами");
      await page.screenshot({ path: "screenshots/desktop-transistor.png" });

      // Поставить транзистор мышью: одно нажатие → три соседних отверстия
      await page.keyboard.press("Escape");
      await page.keyboard.press("0");
      const f3 = await page.evaluate(() => {
        const s = window.maketka.world.toScreen(window.maketka.endpointPos({ hole: "f3" }));
        return { x: s.x, y: s.y };
      });
      await page.mouse.move(f3.x, f3.y);
      await page.mouse.click(f3.x, f3.y);
      await page.waitForTimeout(300);
      const q = await page.evaluate(() => window.maketka.scene.components.at(-1));
      check(q.type === "transistor" && q.placement.holes.join() === "f3,f4,f5", `мышью: транзистор ${q.id} в ${q.placement.holes?.join(", ")}`);
      await page.evaluate((id) => {
        window.maketka.selected = id;
      }, q.id);
      await page.keyboard.press("f");
      const flipped = await page.evaluate((id) => window.maketka.component(id).placement.holes.join(), q.id);
      check(flipped === "f5,f4,f3", `F переворачивает транзистор: ${flipped}`);

      // Пример 4: MOSFET и память затвора (переключаем тумблеры через модель, мышью это уже проверено)
      await page.keyboard.press("Escape");
      await page.keyboard.press("1");
      await page.selectOption("#demo-select", "mosfet");
      await page.waitForTimeout(800);
      const setSwitch = (id, closed) =>
        page.evaluate(([id, closed]) => {
          const a = window.maketka;
          a.component(id).closed = closed;
          a.changed();
        }, [id, closed]);
      const lampI = () => page.evaluate(() => window.maketka.sim.current(window.maketka.component("HL2")));
      const offBefore = await lampI();
      await setSwitch("SA2", true);
      await page.waitForTimeout(600);
      await setSwitch("SA2", false);
      await page.waitForTimeout(1200);
      const stillOn = await lampI();
      await page.screenshot({ path: "screenshots/desktop-mosfet.png" });
      await setSwitch("SA3", true);
      await page.waitForTimeout(600);
      const offAfter = await lampI();
      check(offBefore < 1e-6 && stillOn > 0.05 && offAfter < 1e-6, `память затвора: ${offBefore.toExponential(1)} → ${(stillOn * 1000).toFixed(0)} мА после SA2 → ${offAfter.toExponential(1)} после SA3`);
      // Мелкий TO-92: ищем пиксель рядом с корпусом, который действительно попадает в VT1
      const fet1 = await page.evaluate(() => {
        const a = window.maketka;
        const s = a.world.toScreen(a.views.get("VT1").hotspot);
        for (let dy = 0; dy <= 30; dy += 2) {
          for (const dx of [0, -3, 3, -6, 6]) {
            const p = { clientX: s.x + dx, clientY: s.y + dy };
            if (a.world.pickObject(a.world.ndcFromEvent(p))?.componentId === "VT1") return { x: p.clientX, y: p.clientY };
          }
        }
        return { x: s.x, y: s.y + 6 };
      });
      await page.mouse.click(fet1.x, fet1.y);
      await page.waitForTimeout(400);
      const mpanel = await page.textContent("#inspector");
      check(/2N7000/.test(mpanel ?? "") && /Ток затвора/.test(mpanel ?? ""), "щелчок по VT1: панель MOSFET");
      await page.screenshot({ path: "screenshots/desktop-mosfet-panel.png" });
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
