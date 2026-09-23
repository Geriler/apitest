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
  // Кодировка UTF-8: при системной POSIX браузер заменяет кириллические имена скачанных файлов на «download»
  env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" },
});
const failures = [];
/** Раскрыть список инструментов слева (он свёрнут, как «Примеры…»). */
async function openTools(page) {
  if (!(await page.evaluate(() => document.getElementById("tools").classList.contains("open")))) await page.click("#tools-toggle");
}
/** Выбрать деталь для установки: горячих клавиш у деталей нет, только кнопка в группе списка слева. */
async function pickPart(page, tool) {
  await openTools(page);
  await page.evaluate((t) => {
    const d = document.querySelector(`[data-tool="${t}"]`).closest("details");
    if (!d.open) d.querySelector("summary").click();
  }, tool);
  await page.click(`[data-tool="${tool}"]`);
}
/** Открыть панель «Проекты», если она закрыта. */
async function openProjects(page) {
  if (!(await page.evaluate(() => window.maketka.projectsOpen))) await page.click("#btn-projects");
}
/** Кнопки допусков, тока и замены — в меню «Настройки»: открыть его, если закрыто, и нажать. */
async function settingsClick(page, selector) {
  if (!(await page.evaluate(() => document.getElementById("settings-menu").open))) await page.click("#settings-menu > summary");
  await page.click(selector);
}
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
    await settingsClick(page, "#btn-tol");
    const realI = await hlI();
    const rerollShown = await page.isVisible("#btn-reroll");
    await settingsClick(page, "#btn-reroll");
    const otherI = await hlI();
    await page.screenshot({ path: `screenshots/${viewport.name}-tolerance.png` });
    await settingsClick(page, "#btn-tol");
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

    if (viewport.name === "phone") {
      // Долгое нажатие пальцем вместо Shift+щелчка: открывает панель детали
      const where = await page.evaluate(() => {
        const a = window.maketka;
        const c = a.scene.components.find((x) => x.type === "resistor" && x.placement.mode === "board");
        const s = a.world.toScreen(a.views.get(c.id).hotspot);
        for (let dy = 0; dy <= 12; dy += 2) for (const dx of [0, -2, 2, -4, 4]) {
          const p = { clientX: s.x + dx, clientY: s.y + dy };
          if (a.world.pickObject(a.world.ndcFromEvent(p))?.componentId === c.id) return { id: c.id, x: p.clientX, y: p.clientY };
        }
        return { id: c.id, x: s.x, y: s.y };
      });
      // Настоящие касания через протокол браузера (у синтетических PointerEvent нет активного указателя)
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) =>
        cdp.send("Input.dispatchTouchEvent", {
          type: type === "pointerdown" ? "touchStart" : "touchEnd",
          touchPoints: type === "pointerdown" ? [{ x, y }] : [],
        });
      // Короткое: начало и конец касания уходят сразу друг за другом (медленный тестовый браузер
      // иначе растягивает касание на полсекунды между командами)
      touch("pointerdown", where.x, where.y);
      await touch("pointerup", where.x, where.y);
      await page.waitForTimeout(200);
      const shortTap = await page.evaluate(() => window.maketka.selected ?? "");
      await touch("pointerdown", where.x, where.y);
      await page.waitForTimeout(700);
      await touch("pointerup", where.x, where.y);
      await page.waitForTimeout(300);
      const longPress = await page.evaluate(() => ({ sel: window.maketka.selected ?? "", hidden: document.getElementById("inspector").hidden }));
      check(shortTap === "" && longPress.sel === where.id && !longPress.hidden, `phone: короткое касание ${where.id} без панели (открыто: «${shortTap}»), долгое — панель (${JSON.stringify(longPress)})`);
    }

    if (viewport.name === "desktop") {
      // Панель инструментов: группы раскрываются, выбор инструмента закрывает группу и подсвечивает её
      // Список инструментов изначально свёрнут
      const collapsed = await page.evaluate(() => document.getElementById("tools-list").hidden);
      await openTools(page);
      await page.click('details[data-group="power"] > summary');
      const opened = await page.isVisible('[data-tool="psu"]');
      await page.click('[data-tool="psu"]');
      await page.waitForTimeout(200);
      const grp = await page.evaluate(() => ({
        tool: window.maketka.tool,
        open: document.querySelector('details[data-group="power"]').open,
        active: document.querySelector('details[data-group="power"] > summary').classList.contains("active"),
      }));
      const afterPick = await page.evaluate(() => ({ hidden: document.getElementById("tools-list").hidden, label: document.querySelector(".brand-tool").textContent }));
      check(collapsed && opened && grp.tool === "psu" && !grp.open && grp.active && afterPick.hidden && afterPick.label === "Блок питания", `инструменты свёрнуты; раскрыли, выбрали блок питания — список свернулся, в заголовке «${afterPick.label}»`);
      await page.keyboard.press("1");
      // Сводка справа — только по «?»
      const hiddenByDefault = await page.evaluate(() => document.getElementById("inspector").hidden);
      await page.click("#btn-help");
      await page.waitForTimeout(200);
      const helpShown = await page.evaluate(() => !document.getElementById("inspector").hidden && /Как устроена макетка/.test(document.getElementById("inspector").textContent));
      await page.click("#btn-help");
      await page.waitForTimeout(200);
      check(hiddenByDefault && helpShown && (await page.evaluate(() => document.getElementById("inspector").hidden)), "сводка и подсказки справа — только по кнопке «?»");

      // Панель детали — только по щелчку, не при наведении
      const r1 = await page.evaluate(() => {
        const s = window.maketka.world.toScreen(window.maketka.views.get("R1").hotspot);
        return { x: s.x, y: s.y };
      });
      await page.mouse.move(r1.x, r1.y);
      await page.waitForTimeout(400);
      check(!/Резистор 3,3 Ом/.test(await page.textContent("#inspector")), "наведение на R1 не открывает его панель");
      await page.keyboard.down("Shift");
      await page.mouse.click(r1.x, r1.y);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(400);
      check(/Резистор 3,3 Ом/.test(await page.textContent("#inspector")), "Shift+щелчок по R1 открывает его панель");
      await page.keyboard.press("Escape");

      // Замкнуть SA2 одним нажатием мышью, второе — разомкнуть, третье — снова замкнуть
      const sa2 = await page.evaluate(() => {
        const a = window.maketka;
        const p = a.views.get("SA2").hotspot.clone();
        p.y -= 1.2;
        const s = a.world.toScreen(p);
        return { x: s.x, y: s.y };
      });
      const clicks = [];
      for (let i = 0; i < 3; i++) {
        await page.mouse.click(sa2.x, sa2.y);
        await page.waitForTimeout(200);
        clicks.push(await page.evaluate(() => window.maketka.component("SA2").closed));
      }
      const closed = clicks[2];
      check(clicks.join() === "true,false,true", `мышью: SA2 щёлкается с каждого нажатия (${clicks.join(" → ")})`);
      const afterClicks = await page.evaluate(() => ({ sel: window.maketka.selected ?? "", title: document.querySelector("#inspector h2")?.textContent ?? "" }));
      check(afterClicks.sel !== "SA2" && afterClicks.title !== "Тумблер", `щелчок по тумблеру не открывает его панель (открыто: «${afterClicks.title}»)`);
      await page.keyboard.down("Shift");
      await page.mouse.click(sa2.x, sa2.y);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(200);
      const shiftSel = await page.evaluate(() => ({ sel: window.maketka.selected, closed: window.maketka.component("SA2").closed }));
      check(shiftSel.sel === "SA2" && shiftSel.closed === true, `Shift+щелчок открывает панель тумблера и не переключает его`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1200);
      await page.screenshot({ path: "screenshots/desktop-smoke.png" });
      await page.waitForTimeout(3500);
      const burned = await page.evaluate(() => window.maketka.sim.state("R2").burned);
      check(burned, "R2 22 Ом сгорел после замыкания SA2");
      await page.screenshot({ path: "screenshots/desktop-burned.png" });

      // Поставить выводной резистор мышью между f12 и f16
      await pickPart(page, "tht");
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
      await pickPart(page, "battery");
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

      // Мультиметр: только кнопкой (горячих клавиш у деталей нет), в плату не ставится, на стол — да
      await page.keyboard.press("3");
      check((await page.evaluate(() => window.maketka.tool)) !== "tht", "клавиша 3 больше не выбирает резистор");
      await pickPart(page, "meter");
      await page.mouse.move(h.x, h.y);
      await page.mouse.click(h.x, h.y);
      check(/лежит на столе/.test((await page.textContent("#hint")) ?? ""), "мультиметр на макетку: показана подсказка");
      const table = await page.evaluate(() => {
        // Свободное место стола рядом с батареей (Vector3 берём у вывода батареи)
        const p = window.maketka.endpointPos({ comp: "GB1", pin: 0 });
        p.set(p.x - 4, 0, p.z + 10);
        const s = window.maketka.world.toScreen(p);
        return { x: s.x, y: s.y };
      });
      const nBefore = await page.evaluate(() => window.maketka.scene.components.length);
      await page.mouse.move(table.x, table.y);
      await page.mouse.click(table.x, table.y);
      await page.waitForTimeout(200);
      const meterPlaced = await page.evaluate(() => {
        const c = window.maketka.scene.components.at(-1);
        return { n: window.maketka.scene.components.length, type: c.type, mode: c.mode };
      });
      check(meterPlaced.n === nBefore + 1 && meterPlaced.type === "meter" && meterPlaced.mode === "V", `мультиметр встал на стол (${meterPlaced.type}, ${meterPlaced.mode})`);
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
      const selected = await page.evaluate(() => window.maketka.picked);
      await page.keyboard.press("f");
      await page.waitForTimeout(400);
      const hl3After = await page.evaluate(() => window.maketka.sim.current(window.maketka.component("HL3")));
      check(selected === "HL3" && hl3After > 0.01, `мышью: HL3 выделен щелчком (${selected}) и после F горит (${(hl3After * 1000).toFixed(1)} мА)`);

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
      // По умолчанию — прямая перемычка: лежит на плате (выше поверхности не больше чем на толщину провода)
      const flatInfo = await page.evaluate((id) => {
        const a = window.maketka;
        const v = a.wireViews.get(id);
        let maxY = -1;
        v.mesh.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          maxY = Math.max(maxY, b.max.y);
        });
        return { shape: a.scene.wires.find((w) => w.id === id).shape, maxY, top: a.endpointPos({ hole: "f2" }).y };
      }, wire.id);
      await page.screenshot({ path: "screenshots/desktop-jumper.png" });
      check(flatInfo.shape === "flat" && flatInfo.maxY - flatInfo.top < 0.7, `прямая перемычка лежит на плате: верх на ${(flatInfo.maxY - flatInfo.top).toFixed(2)} шага над ней`);
      // Переключить готовый провод на гибкий из его панели
      await page.keyboard.press("Escape");
      await page.keyboard.press("1");
      await page.evaluate((id) => {
        window.maketka.selected = id;
        window.maketka.renderInspector();
      }, wire.id);
      await page.click('#inspector [data-shape="arc"]');
      await page.waitForTimeout(300);
      const arcInfo = await page.evaluate((id) => {
        const a = window.maketka;
        return { shape: a.scene.wires.find((w) => w.id === id).shape, h: a.wireViews.get(id).curve.getPoint(0.5).y - a.endpointPos({ hole: "f2" }).y, title: document.querySelector("#inspector h2").textContent };
      }, wire.id);
      check(arcInfo.shape === "arc" && arcInfo.h > 1 && arcInfo.title === "Провод", `в панели провода — «Гибкий, дугой»: середина на ${arcInfo.h.toFixed(1)} шага над платой`);

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
      // Обычный щелчок только выделяет, панель — по Shift+щелчку
      await page.mouse.click(vt1.x, vt1.y);
      await page.waitForTimeout(300);
      const plain = await page.evaluate(() => ({ picked: window.maketka.picked, selected: window.maketka.selected ?? "" }));
      check(plain.picked === "VT1" && plain.selected === "", `обычный щелчок по VT1 выделяет без панели (${JSON.stringify(plain)})`);
      await page.keyboard.down("Shift");
      await page.mouse.click(vt1.x, vt1.y);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(400);
      const panel = await page.textContent("#inspector");
      check(/BC547B/.test(panel ?? "") && /I(К|к)/.test(panel ?? ""), "Shift+щелчок по VT1: панель транзистора с токами");
      await page.screenshot({ path: "screenshots/desktop-transistor.png" });

      // Поставить транзистор мышью: одно нажатие → три соседних отверстия
      await page.keyboard.press("Escape");
      await pickPart(page, "bjt");
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
      await page.keyboard.down("Shift");
      await page.mouse.click(fet1.x, fet1.y);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(400);
      const mpanel = await page.textContent("#inspector");
      check(/2N7000/.test(mpanel ?? "") && /Ток затвора/.test(mpanel ?? ""), "Shift+щелчок по VT1: панель MOSFET");

      // Пример 5: печатная плата и блок питания
      await page.keyboard.press("Escape");
      await page.keyboard.press("1");
      await page.selectOption("#demo-select", "pcb");
      await page.waitForTimeout(1200);
      await page.screenshot({ path: "screenshots/desktop-pcb.png" });
      const pcbI = await page.evaluate(() => ["HL1", "HL2"].map((id) => window.maketka.sim.current(window.maketka.component(id))));
      check(pcbI.every((i) => i > 0.013), `печатная плата: светодиоды ${pcbI.map((i) => (i * 1000).toFixed(1)).join(" и ")} мА`);

      // Нарисовать дорожку мышью B2 → B6: четыре отрезка
      await page.keyboard.press("t");
      const padPts = await page.evaluate(() => ["pB2", "pB6"].map((id) => {
        const s = window.maketka.world.toScreen(window.maketka.endpointPos({ hole: id }));
        return { x: s.x, y: s.y };
      }));
      const tracesBefore = await page.evaluate(() => window.maketka.scene.traces.length);
      for (const pt of padPts) {
        await page.mouse.move(pt.x, pt.y);
        await page.mouse.click(pt.x, pt.y);
      }
      await page.keyboard.press("Escape");
      const added = await page.evaluate((n) => window.maketka.scene.traces.slice(n).map((t) => `${t.a}-${t.b}`), tracesBefore);
      check(added.join() === "pB2-pB3,pB3-pB4,pB4-pB5,pB5-pB6", `мышью: дорожка B2 → B6 = ${added.join(", ")}`);

      // Блок питания: выбрать и ползунком ограничить ток до 20 мА → CC
      await page.keyboard.press("1");
      await page.evaluate(() => {
        const a = window.maketka;
        a.selected = "G1";
        a.renderInspector();
      });
      await page.waitForTimeout(300);
      await page.$eval("#f-psuA", (el) => {
        el.value = "0.02";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(500);
      const psu = await page.evaluate(() => {
        const a = window.maketka;
        return { mode: a.sim.psuMode.get("G1"), total: ["HL1", "HL2"].reduce((s, id) => s + a.sim.current(a.component(id)), 0) };
      });
      const psuPanel = await page.textContent("#inspector");
      await page.screenshot({ path: "screenshots/desktop-psu.png" });
      check(psu.mode === "CC" && Math.abs(psu.total - 0.02) < 1e-4 && /CC/.test(psuPanel ?? ""), `блок питания: ${psu.mode}, ${(psu.total * 1000).toFixed(1)} мА на оба светодиода`);

      // Ток: выключить точки — показания остаются
      const dotsOn = await page.evaluate(() => window.maketka.world.dots.count);
      await settingsClick(page, "#btn-current");
      await page.waitForTimeout(300);
      const dotsOff = await page.evaluate(() => window.maketka.world.dots.count);
      const stillCC = await page.evaluate(() => window.maketka.sim.psuMode.get("G1"));
      check(dotsOn > 0 && dotsOff === 0 && stillCC === "CC", `кнопка «Ток»: точек ${dotsOn} → ${dotsOff}, расчёт идёт (${stillCC})`);
      await settingsClick(page, "#btn-current");

      // Платы как предметы: положить, выбрать, перетащить, убрать
      const scr = (x, y, z) =>
        page.evaluate(([x, y, z]) => {
          const w = window.maketka.world;
          const V = w.camera.position.constructor;
          const p = w.toScreen(new V(x, y, z));
          return { x: p.x, y: p.y };
        }, [x, y, z]);
      const boards = () => page.evaluate(() => window.maketka.scene.boards.map((b) => ({ ...b })));
      const bb2 = () => boards().then((bs) => bs.find((b) => b.id === "BB2"));
      // Отъехать камерой, чтобы было видно свободный стол перед платами
      await page.evaluate(() => {
        const w = window.maketka.world;
        w.camera.position.sub(w.controls.target).multiplyScalar(1.7).add(w.controls.target);
        w.controls.update();
      });
      await page.waitForTimeout(300);
      await page.keyboard.press("b");
      let pt = await scr(0, 0, 48);
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(400);
      const bbPlaced = await bb2();
      check(bbPlaced && Math.abs(bbPlaced.x) <= 1 && Math.abs(bbPlaced.z - 48) <= 1, `макетка положена мышью: ${JSON.stringify(bbPlaced)}`);
      // На занятое место (поверх печатной платы) не кладётся
      pt = await scr(0, 0.7, 21);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(300);
      check((await boards()).length === 3, `поверх другой платы не кладётся (плат ${(await boards()).length})`);
      // Резистор на новую макетку, потом перенос платы вместе с ним
      await page.evaluate(() => {
        const a = window.maketka;
        a.scene.components.push({ id: "R9", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: { mode: "board", holes: ["2:a1", "2:a5"] } });
        a.changed();
      });
      await page.keyboard.press("1");
      pt = await scr(bbPlaced.x + 5, 3.3, bbPlaced.z + 3.5);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(300);
      const selectedBoard = await page.evaluate(() => window.maketka.selectedBoard);
      const bbPanel = await page.textContent("#inspector");
      check(selectedBoard === "BB2" && /Макетка 2/.test(bbPanel ?? ""), `щелчок по макетке выбирает её (${selectedBoard}), панель: «Макетка 2»`);
      const camBefore = await page.evaluate(() => window.maketka.world.camera.position.toArray());
      const ptTo = await scr(bbPlaced.x + 25, 3.3, bbPlaced.z + 3.5);
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await page.mouse.move((pt.x + ptTo.x) / 2, (pt.y + ptTo.y) / 2, { steps: 5 });
      await page.mouse.move(ptTo.x, ptTo.y, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const bbMoved = await bb2();
      const camAfter = await page.evaluate(() => window.maketka.world.camera.position.toArray());
      const r9 = await page.evaluate(() => window.maketka.endpointPos({ hole: "2:a1" }).toArray());
      check(
        Math.abs(bbMoved.x - bbPlaced.x - 20) <= 1.5 && Math.abs(bbMoved.z - bbPlaced.z) <= 1.5 && Math.abs(r9[0] - (bbMoved.x - 14.5)) < 1e-9,
        `макетка перетащена на ${bbMoved.x - bbPlaced.x}, ${bbMoved.z - bbPlaced.z}; R9 уехал вместе с ней`,
      );
      check(camBefore.every((v, i) => Math.abs(v - camAfter[i]) < 1e-6), "при переносе платы камера не вращается");
      await page.screenshot({ path: "screenshots/desktop-boards.png" });
      // Удалить непустую — отказ с именем детали; пустую — убирается
      await page.keyboard.press("Delete"); // ничего не выбрано из деталей → убрать выбранную плату
      await page.waitForTimeout(300);
      const bbToast = await page.textContent("#toasts");
      check((await bb2()) && /R9/.test(bbToast ?? ""), "непустая плата не убирается, названа R9");
      await page.evaluate(() => window.maketka.remove("R9"));
      await openTools(page);
      await page.click('[data-tool="delete"]');
      pt = await scr(bbMoved.x + 5, 3.3, bbMoved.z + 3.5);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(300);
      check(!(await bb2()), "пустая макетка убрана инструментом «Удалить»");
      // Печатная плата больше: через панель платы
      await page.keyboard.press("1");
      pt = await scr(-6, 0.7, 20.5);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(300);
      await page.selectOption("#f-boardSize", "36x20");
      await page.waitForTimeout(400);
      const pcbSpec = (await boards()).find((b) => b.id === "PCB1");
      const bbLeds = await page.evaluate(() => ["HL1", "HL2"].map((id) => window.maketka.sim.current(window.maketka.component(id))));
      check(pcbSpec.cols === 36 && pcbSpec.rows === 20 && bbLeds.every((i) => i > 0.009), `печатная плата 36 × 20, схема на месте (${bbLeds.map((i) => (i * 1000).toFixed(1)).join(" и ")} мА)`);
      // «Очистить» оставляет платы
      await page.click("#btn-clear");
      await page.click("#btn-clear");
      await page.waitForTimeout(300);
      const bbAfter = await page.evaluate(() => ({ n: window.maketka.scene.components.length, boards: window.maketka.scene.boards.map((b) => b.id) }));
      check(bbAfter.n === 0 && bbAfter.boards.length === 0, `«Очистить» убрал всё, включая платы (осталось плат: ${bbAfter.boards.length})`);
      // На пустой стол можно снова положить плату
      await page.keyboard.press("b");
      const empty = await scr(0, 0, 0);
      await page.mouse.move(empty.x, empty.y);
      await page.mouse.click(empty.x, empty.y);
      await page.waitForTimeout(400);
      const again = await boards();
      check(again.length === 1 && again[0].id === "BB1", `на пустой стол положена ${again.map((b) => b.id).join()}`);
      await page.keyboard.press("1");
      // Пример с печатной платой загружается и на пустой стол
      await page.click("#btn-clear");
      await page.click("#btn-clear");
      await page.waitForTimeout(300);
      await page.selectOption("#demo-select", "pcb");
      await page.waitForTimeout(500);
      const pcbDemo = await page.evaluate(() => ({ parts: window.maketka.scene.components.length, traces: window.maketka.scene.traces.length, hl1: window.maketka.sim.current(window.maketka.component("HL1")) }));
      check(pcbDemo.parts === 5 && pcbDemo.traces > 0 && pcbDemo.hl1 > 0.01, `пример «Печатная плата» после «Очистить»: ${pcbDemo.parts} деталей, ${pcbDemo.traces} дорожек, HL1 ${(pcbDemo.hl1 * 1000).toFixed(1)} мА`);
      await page.screenshot({ path: "screenshots/desktop-mosfet-panel.png" });

      // Номиналы: у резистора в панели меняется мощность — меняются предел и размер корпуса
      await page.selectOption("#demo-select", "lamps");
      await page.waitForTimeout(500);
      const sizeOf = () =>
        page.evaluate(() => {
          const g = window.maketka.views.get("R1").group;
          let min = Infinity, max = -Infinity;
          g.traverse((o) => {
            if (!o.isMesh || o.geometry.type !== "CapsuleGeometry") return;
            o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox;
            min = Math.min(min, b.min.y);
            max = Math.max(max, b.max.y);
          });
          return max - min;
        });
      const rBefore = await sizeOf();
      await page.evaluate(() => {
        window.maketka.selected = "R1";
        window.maketka.renderInspector();
      });
      await page.selectOption("#f-watts", "2");
      await page.waitForTimeout(400);
      const rated = await page.evaluate(() => ({ watts: window.maketka.component("R1").watts, limit: window.maketka.sim.load(window.maketka.component("R1")).limit }));
      const rAfter = await sizeOf();
      check(rated.watts === 2 && rated.limit === "2 Вт" && rAfter > rBefore * 2, `резистор R1 на 2 Вт: предел ${rated.limit}, корпус ${rBefore.toFixed(2)} → ${rAfter.toFixed(2)}`);

      // Отмена: удалить деталь, Ctrl+Z, Ctrl+Y; «Очистить» тоже отменяется
      await page.keyboard.press("Escape");
      await page.keyboard.press("1");
      const ids = () => page.evaluate(() => window.maketka.scene.components.map((c) => c.id).join());
      const full = await ids();
      await page.evaluate(() => window.maketka.remove("R2"));
      const removed = await ids();
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(200);
      const undone = await ids();
      await page.keyboard.press("Control+y");
      await page.waitForTimeout(200);
      const redone = await ids();
      check(!removed.includes("R2") && undone === full && redone === removed, `Ctrl+Z вернул R2 (${undone}), Ctrl+Y снова убрал`);
      await page.click("#btn-clear");
      await page.click("#btn-clear");
      await page.waitForTimeout(300);
      const cleared = await page.evaluate(() => ({ n: window.maketka.scene.components.length, b: window.maketka.scene.boards.length }));
      const marks = await page.evaluate(() => window.maketka.world.holeMarks.count);
      check(marks === 0, `на пустом столе нет подсветки отверстий (белого квадрата): ${marks}`);
      await page.click("#btn-undo");
      await page.waitForTimeout(300);
      const back = await page.evaluate(() => ({ ids: window.maketka.scene.components.map((c) => c.id).join(), b: window.maketka.scene.boards.length, redo: !document.getElementById("btn-redo").disabled }));
      check(cleared.n === 0 && cleared.b === 0 && back.ids === removed && back.b > 0 && back.redo, `кнопка ↶ отменила «Очистить»: детали и платы на месте (${back.ids})`);

      // Перенос детали на плате мышью: берём за вывод и тащим на свободные отверстия
      await page.keyboard.press("Escape");
      await page.keyboard.press("1");
      const plan = await page.evaluate(() => {
        const a = window.maketka;
        const c = a.scene.components.find((x) => x.type === "resistor" && x.placement.mode === "board");
        const H = (id) => window.maketka.endpointPos({ hole: id });
        const grab = c.placement.holes[0];
        // Свободное место: сдвиг по столбцам, при котором все выводы попадают в пустые отверстия
        for (const dz of [0, 1, -1, 2, -2]) for (const dx of [3, -3, 4, -4, 5, -5, 6, -6]) {
          const from = c.placement.holes;
          const g = H(grab);
          const hs = from.map((id) => { const p = H(id); return [p.x + dx, p.z + dz]; });
          const occ = new Set(a.scene.components.filter((x) => x.id !== c.id && x.placement.mode === "board").flatMap((x) => x.placement.holes).concat(a.scene.wires.flatMap((w) => [w.a, w.b]).filter((e) => "hole" in e).map((e) => e.hole)));
          const ids = hs.map(([x, z]) => { for (const id of ["a","b","c","d","e","f","g","h","i","j"].flatMap((r) => Array.from({ length: 30 }, (_, k) => r + (k + 1)))) { const p = H(id); if (Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6) return id; } return null; });
          if (ids.every((id) => id && !occ.has(id))) {
            const s0 = a.world.toScreen(g);
            const t = H(ids[0]);
            const s1 = a.world.toScreen(t);
            return { id: c.id, from: from.join(), expect: ids.join(), a: { x: s0.x, y: s0.y }, b: { x: s1.x, y: s1.y } };
          }
        }
        return null;
      });
      await page.mouse.move(plan.a.x, plan.a.y);
      await page.mouse.down();
      await page.mouse.move((plan.a.x + plan.b.x) / 2, (plan.a.y + plan.b.y) / 2, { steps: 4 });
      await page.mouse.move(plan.b.x, plan.b.y, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const dragged = await page.evaluate((id) => window.maketka.component(id).placement.holes.join(), plan.id);
      check(dragged === plan.expect, `деталь ${plan.id} перетащена мышью: ${plan.from} → ${dragged} (ожидалось ${plan.expect})`);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(200);
      const backHoles = await page.evaluate((id) => window.maketka.component(id).placement.holes.join(), plan.id);
      check(backHoles === plan.from, `перенос отменяется Ctrl+Z (${backHoles})`);

      // Проекты: сохранить, очистить, открыть; скачать файл и открыть его обратно
      await page.selectOption("#demo-select", "blinker");
      await page.waitForTimeout(400);
      const blinkerIds = await page.evaluate(() => window.maketka.scene.components.map((c) => c.id).join());
      await openProjects(page);
      await page.fill("#f-proj-name", "Моя мигалка");
      await page.click('[data-proj-act="save"]');
      await page.waitForTimeout(200);
      const listed = await page.textContent("#inspector .list.projects");
      await page.click("#btn-clear");
      await page.click("#btn-clear");
      await page.waitForTimeout(300);
      await openProjects(page);
      await page.click('[data-proj-act="open"][data-name="Моя мигалка"]');
      await page.waitForTimeout(400);
      const reopened = await page.evaluate(() => ({ ids: window.maketka.scene.components.map((c) => c.id).join(), name: window.maketka.projectName }));
      check(/Моя мигалка/.test(listed ?? "") && reopened.ids === blinkerIds && reopened.name === "Моя мигалка", `проект сохранён и открыт после «Очистить»: ${reopened.ids}`);
      const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-proj-act="export"]')]);
      const fileText = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
      const file = JSON.parse(fileText);
      check(download.suggestedFilename() === "Моя мигалка.json" && file.app === "maketka" && file.scene.components.length > 0, `скачан файл ${download.suggestedFilename()}`);
      await page.selectOption("#demo-select", "lamps");
      await page.waitForTimeout(300);
      await openProjects(page);
      await page.setInputFiles("#f-proj-file", { name: "Моя мигалка.json", mimeType: "application/json", buffer: Buffer.from(fileText) });
      await page.waitForTimeout(500);
      const imported = await page.evaluate(() => ({ ids: window.maketka.scene.components.map((c) => c.id).join(), name: window.maketka.projectName }));
      check(imported.ids === blinkerIds && imported.name === "Моя мигалка", `файл проекта открыт: «${imported.name}»`);
      await page.setInputFiles("#f-proj-file", { name: "чужой.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
      await page.waitForTimeout(300);
      check(/Не открылось/.test((await page.textContent("#toasts")) ?? ""), "чужой файл — понятная ошибка, схема на месте");

      // Принципиальная схема: открыть, щелчок по резистору — его панель, по тумблеру — переключение
      await page.selectOption("#demo-select", "lamps");
      await page.waitForTimeout(400);
      await page.click("#btn-schematic");
      await page.waitForTimeout(500);
      const schParts = await page.evaluate(() => [...document.querySelectorAll("#schematic [data-part]")].map((g) => g.dataset.part).sort().join());
      const allParts = await page.evaluate(() => window.maketka.scene.components.map((c) => c.id).sort().join());
      check(schParts === allParts, `на схеме все детали: ${schParts}`);
      await page.click('#schematic [data-part="R1"]');
      await page.waitForTimeout(300);
      const schSel = await page.evaluate(() => ({ sel: window.maketka.selected, title: document.querySelector("#inspector h2")?.textContent }));
      const sa1Before = await page.evaluate(() => window.maketka.component("SA1").closed);
      await page.click('#schematic [data-part="SA1"]');
      await page.waitForTimeout(300);
      const sa1After = await page.evaluate(() => window.maketka.component("SA1").closed);
      check(schSel.sel === "R1" && /Резистор/.test(schSel.title ?? "") && sa1After === !sa1Before, `щелчок по R1 на схеме — его панель, по SA1 — переключение (${sa1Before} → ${sa1After})`);
      // Чертёж не перестраивается от щелчка тумблером
      const netYs = () => page.evaluate(() => [...document.querySelectorAll("#schematic [data-net]")].map((g) => `${g.dataset.net}:${g.dataset.y}`).join());
      const ysBefore = await netYs();
      await page.click('#schematic [data-part="SA1"]');
      await page.waitForTimeout(400);
      check((await netYs()) === ysBefore, "щелчок тумблером на схеме не перестраивает чертёж");
      // Перетаскивание: R1 вправо, потом Ctrl+Z
      const r1box = await page.locator('#schematic [data-part="R1"] .hit').boundingBox();
      await page.mouse.move(r1box.x + 10, r1box.y + r1box.height / 2);
      await page.mouse.down();
      await page.mouse.move(r1box.x + 50, r1box.y + r1box.height / 2, { steps: 5 });
      await page.mouse.move(r1box.x + 90, r1box.y + r1box.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const schDragged = await page.evaluate(() => ({ x: window.maketka.scene.schematic?.x?.R1, sel: window.maketka.selected, reset: !document.getElementById("btn-sch-reset").hidden }));
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(300);
      const schUndone = await page.evaluate(() => window.maketka.scene.schematic?.x?.R1);
      check(schDragged.x > 0 && schDragged.reset && schUndone === undefined, `R1 на схеме перетащен (x = ${schDragged.x}), «Сбросить» появилась, Ctrl+Z вернул`);
      await page.screenshot({ path: "screenshots/desktop-schematic.png" });
      // На весь экран и обратно по Esc
      await page.click("#btn-sch-full");
      await page.waitForTimeout(300);
      const fullBox = await page.locator("#schematic").boundingBox();
      await page.screenshot({ path: "screenshots/desktop-schematic-full.png" });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const normalBox = await page.locator("#schematic").boundingBox();
      check(fullBox.width > 1300 && fullBox.height > 800 && normalBox.width < 700, `схема на весь экран: ${Math.round(fullBox.width)}×${Math.round(fullBox.height)}, Esc вернул ${Math.round(normalBox.width)}×${Math.round(normalBox.height)}`);
      await page.click("#btn-schematic");

      // Схема пользователя «Элемент ИЛИ» со светодиодами 1 Вт: страница не зависает, ошибок нет
      const orText = (await import("node:fs")).readFileSync("tests/fixtures/element-or.json", "utf8");
      await page.evaluate((text) => {
        const d = JSON.parse(text);
        d.scene.components = d.scene.components.map((c) => (c.type === "lamp" ? { id: c.id, type: "led", color: "red", size: "1W", placement: c.placement } : c));
        window.maketka.replaceScene(d.scene);
        for (const id of ["SA3", "SA4"]) window.maketka.component(id).closed = false;
        window.maketka.changed();
      }, orText);
      // Время одного шага расчёта (кадры здесь не показательны: тестовый браузер рисует 3D программно)
      const stepMs = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const sim = window.maketka.sim;
            const orig = sim.step.bind(sim);
            let total = 0;
            let n = 0;
            sim.step = (dt) => {
              const t = performance.now();
              const r = orig(dt);
              total += performance.now() - t;
              n++;
              return r;
            };
            setTimeout(() => {
              sim.step = orig;
              resolve(n ? total / n : Infinity);
            }, 2500);
          }),
      );
      const orToast = (await page.textContent("#toasts")) ?? "";
      check(stepMs < 60 && !/не справился/.test(orToast), `«Элемент ИЛИ» со светодиодами: шаг расчёта ${stepMs.toFixed(0)} мс, ошибок нет`);
      await page.keyboard.press("Escape");
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
