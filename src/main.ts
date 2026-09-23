import { App } from "./app";
import { blinkerScene, demoScene, ledDemoScene, mosfetScene } from "./demo";
import { World } from "./view/world";

async function start(): Promise<void> {
  // Шрифты нужны до отрисовки текстур с подписями; ждём не дольше 1,5 с.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

  const $ = (id: string) => document.getElementById(id)!;
  const world = new World($("stage"));
  // Панели на широком экране закрывают края сцены — камера это учитывает
  const setInsets = () => {
    const wide = window.innerWidth > 760;
    world.insets = wide ? { left: $("tools").getBoundingClientRect().right + 8, right: 300 + 32 } : { left: 0, right: 0 };
    world.resize();
  };
  setInsets();
  window.addEventListener("resize", setInsets);
  const saved = App.load();
  const app = new App(world, { inspector: $("inspector"), hint: $("hint"), toasts: $("toasts"), tools: $("tools") }, saved ?? demoScene());
  if (!saved) {
    app.toast("Это пример", "Замкните тумблер SA2 (нажмите на него дважды): резистор R2 22 Ом не выдержит мощности и сгорит. Потом выберите R2 и поставьте номинал побольше.");
  }

  const demos = {
    lamps: {
      scene: demoScene,
      tip: "Замкните тумблер SA2 (нажмите на него дважды): резистор R2 22 Ом не выдержит мощности и сгорит.",
    },
    leds: {
      scene: ledDemoScene,
      tip: "Разомкните SA1 — светодиод HL1 будет гаснуть несколько секунд: его питает конденсатор C1. Внизу HL3 вставлен наоборот и не горит: нажмите на него и затем F.",
    },
    mosfet: {
      scene: mosfetScene,
      tip: "Сверху 2N7000 включает светодиод от тумблера SA1 — ток затвора 0. Снизу у IRLZ44N нет стягивающего резистора: замкните и разомкните SA2 — лампа продолжит гореть, затвор «помнит» заряд. SA3 разряжает затвор.",
    },
    blinker: {
      scene: blinkerScene,
      tip: "Светодиоды мигают по очереди: транзисторы VT1 и VT2 открывают друг друга через конденсаторы C1 и C2. Нажмите на VT1 — видно, как малый ток базы управляет током коллектора. Поменяйте C1 или R2 — изменится ритм.",
    },
  };
  const demoSelect = $("demo-select") as HTMLSelectElement;
  demoSelect.addEventListener("change", () => {
    const d = demos[demoSelect.value as keyof typeof demos];
    if (d) {
      app.replaceScene(d.scene());
      app.toast("Пример загружен", d.tip);
    }
    demoSelect.value = "";
    demoSelect.blur();
  });
  $("btn-repair").addEventListener("click", () => app.repairAll());
  const clear = $("btn-clear");
  let armed: ReturnType<typeof setTimeout> | undefined;
  clear.addEventListener("click", () => {
    if (armed) {
      clearTimeout(armed);
      armed = undefined;
      clear.textContent = "Очистить";
      app.replaceScene({ components: [], wires: [] });
      return;
    }
    clear.textContent = "Точно очистить?";
    armed = setTimeout(() => {
      armed = undefined;
      clear.textContent = "Очистить";
    }, 3000);
  });

  const loop = () => {
    app.frame();
    requestAnimationFrame(loop);
  };
  loop();

  // Для отладки и автоматических проверок
  (window as unknown as { maketka: App }).maketka = app;
}

start();
