import { App } from "./app";
import { blinkerScene, demoScene, ledDemoScene, mosfetScene, pcbScene } from "./demo";
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
  const app = new App(world, { inspector: $("inspector"), hint: $("hint"), toasts: $("toasts"), tools: $("tools"), schematic: $("schematic") }, saved ?? demoScene());
  if (!saved) {
    app.toast("Это пример", "Замкните тумблер SA2 (нажмите на него): резистор R2 22 Ом не выдержит мощности и сгорит. Потом выберите R2 и поставьте номинал побольше.");
  }

  const demos = {
    lamps: {
      scene: demoScene,
      tip: "Замкните тумблер SA2 (нажмите на него): резистор R2 22 Ом не выдержит мощности и сгорит.",
    },
    leds: {
      scene: ledDemoScene,
      tip: "Разомкните SA1 — светодиод HL1 будет гаснуть несколько секунд: его питает конденсатор C1. Внизу HL3 вставлен наоборот и не горит: нажмите на него и затем F.",
    },
    mosfet: {
      scene: mosfetScene,
      tip: "Сверху 2N7000 включает светодиод от тумблера SA1 — ток затвора 0. Снизу у IRLZ44N нет стягивающего резистора: замкните и разомкните SA2 — лампа продолжит гореть, затвор «помнит» заряд. SA3 разряжает затвор.",
    },
    pcb: {
      scene: pcbScene,
      tip: "Площадки печатной платы соединены медными дорожками — щёлкните по площадке, чтобы увидеть всю цепь. Выберите блок питания G1 и уменьшите ограничение тока до 20 мА: он перейдёт в режим CC.",
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

  // Группы инструментов и меню «Настройки»: открыто не больше одного, щелчок мимо закрывает
  const groups = [...document.querySelectorAll<HTMLDetailsElement>("#tools details.group")];
  const menus = [...groups, $("settings-menu") as HTMLDetailsElement];
  for (const d of menus) {
    d.addEventListener("toggle", () => {
      if (d.open) for (const o of menus) if (o !== d) o.open = false;
    });
  }
  document.addEventListener("pointerdown", (e) => {
    for (const d of menus) if (d.open && !d.contains(e.target as Node)) d.open = false;
  });
  $("tools").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".group-body [data-tool]")) for (const g of groups) g.open = false;
  });
  // Заголовок группы подсвечен и показывает значок выбранного в ней инструмента
  app.onTool = (tool) => {
    for (const g of groups) {
      const chosen = g.querySelector<HTMLElement>(`.group-body [data-tool="${tool}"]`);
      const head = g.querySelector("summary")!;
      head.classList.toggle("active", !!chosen);
      head.title = chosen?.title ?? head.querySelector(".gname")!.textContent!;
      const icon = (chosen ?? g.querySelector<HTMLElement>(".group-body [data-tool]"))!.querySelector("svg")!.cloneNode(true);
      head.querySelector("svg")!.replaceWith(icon);
    }
  };
  app.onTool(app.tool);

  // «Схема» — принципиальная схема сборки
  const schBtn = $("btn-schematic");
  const setSchematic = (on: boolean) => {
    app.setShowSchematic(on);
    schBtn.setAttribute("aria-pressed", String(on));
  };
  schBtn.addEventListener("click", () => setSchematic(!app.showSchematic));
  $("btn-sch-close").addEventListener("click", () => setSchematic(false));
  const zoomBtn = $("btn-sch-zoom");
  zoomBtn.addEventListener("click", () => {
    const actual = $("schematic").classList.toggle("actual");
    zoomBtn.setAttribute("aria-pressed", String(actual));
  });

  // «Проекты» — панель справа
  const projBtn = $("btn-projects");
  app.onProjects = () => projBtn.setAttribute("aria-pressed", String(app.projectsOpen));
  projBtn.addEventListener("click", () => app.setProjectsOpen(!app.projectsOpen));

  // «?» — сводка по схеме и подсказки
  const helpBtn = $("btn-help");
  helpBtn.addEventListener("click", () => {
    app.showHelp = !app.showHelp;
    helpBtn.setAttribute("aria-pressed", String(app.showHelp));
    app.renderInspector();
  });
  // Отмена и возврат: кнопки активны, только когда есть что отменять или возвращать
  const undoBtn = $("btn-undo") as HTMLButtonElement;
  const redoBtn = $("btn-redo") as HTMLButtonElement;
  app.onHistory = () => {
    undoBtn.disabled = !app.canUndo;
    redoBtn.disabled = !app.canRedo;
  };
  undoBtn.addEventListener("click", () => app.undo());
  redoBtn.addEventListener("click", () => app.redo());
  const currentBtn = $("btn-current");
  const showCurrentState = () => {
    currentBtn.setAttribute("aria-pressed", String(app.showCurrent));
    currentBtn.textContent = app.showCurrent ? "Ток: вкл." : "Ток: выкл.";
  };
  currentBtn.addEventListener("click", () => {
    app.setShowCurrent(!app.showCurrent);
    showCurrentState();
  });
  showCurrentState();

  // Режим «реальные допуски»
  const tolBtn = $("btn-tol");
  const reroll = $("btn-reroll");
  const showTolerance = () => {
    const on = app.tolerance.enabled;
    tolBtn.setAttribute("aria-pressed", String(on));
    tolBtn.textContent = on ? "Допуски: вкл." : "Допуски: выкл.";
    reroll.hidden = !on;
  };
  tolBtn.addEventListener("click", () => {
    const on = !app.tolerance.enabled;
    app.setTolerance({ ...app.tolerance, enabled: on });
    showTolerance();
    if (on) {
      app.toast(
        "Допуски включены",
        "Теперь у каждой детали параметры немного отличаются от номинала: резисторы ±5 %, электролиты ±20 %, β транзисторов 200–450, порог MOSFET по даташиту. «Другие экземпляры» — взять другие детали из той же коробки.",
      );
    }
  });
  reroll.addEventListener("click", () => {
    app.setTolerance({ enabled: true, seed: Math.floor(Math.random() * 1e9) });
  });
  showTolerance();
  const clear = $("btn-clear");
  let armed: ReturnType<typeof setTimeout> | undefined;
  clear.addEventListener("click", () => {
    if (armed) {
      clearTimeout(armed);
      armed = undefined;
      clear.textContent = "Очистить";
      // Пустой стол: без деталей, проводов, дорожек и плат
      app.replaceScene({ components: [], wires: [], boards: [] });
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
