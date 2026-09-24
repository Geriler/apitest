import { App } from "./app";
import { blinkerScene, demoScene, ledDemoScene, mosfetScene, pcbScene, scopeScene } from "./demo";
import { World } from "./view/world";
import { workshopScene } from "./career/session";

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
  // У каждого режима свой стол: песочница — схема или пример, карьера — уровень или мастерская
  const mode = App.loadMode();
  const saved = mode === "career" ? App.loadCareer() : App.load();
  const app = new App(world, { inspector: $("inspector"), hint: $("hint"), toasts: $("toasts"), tools: $("tools"), schematic: $("schematic") }, saved ?? (mode === "career" ? workshopScene() : demoScene()));
  // Первый раз — выбор режима; в карьере без начатого стола — карта
  if (!mode) app.openMenu();
  else if (mode === "career" && !saved) app.openMap();
  if (!saved && mode !== "career") {
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
    scope: {
      scene: scopeScene,
      tip: "Осциллограф смотрит на транзистор VT1: жёлтый — коллектор, голубой — база. Когда открывается VT2, конденсатор C2 толкает базу VT1 в минус (≈ −6,5 В), и она медленно возвращается через R2 — так получается ритм. Нажмите на осциллограф P1: там крупный экран, развёртка и «Стоп».",
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
      // На телефоне список группы — полоса прямо над панелью инструментов (её высота зависит от раскрытия)
      const body = d.querySelector<HTMLElement>(".group-body");
      if (d.open && body && window.innerWidth <= 760) body.style.bottom = `${window.innerHeight - $("tools").getBoundingClientRect().top + 8}px`;
      else if (body) body.style.bottom = "";
    });
  }
  document.addEventListener("pointerdown", (e) => {
    for (const d of menus) if (d.open && !d.contains(e.target as Node)) d.open = false;
  });
  $("tools").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".group-body [data-tool]")) for (const g of groups) g.open = false;
  });
  // Список инструментов свёрнут, как «Примеры…»: заголовок раскрывает, выбор или щелчок мимо сворачивает
  const tools = $("tools");
  const toolsList = $("tools-list");
  const toolsToggle = $("tools-toggle");
  const setToolsOpen = (open: boolean) => {
    toolsList.hidden = !open;
    tools.classList.toggle("open", open);
    toolsToggle.setAttribute("aria-expanded", String(open));
    if (!open) for (const g of groups) g.open = false;
  };
  toolsToggle.addEventListener("click", () => setToolsOpen(!tools.classList.contains("open")));
  toolsList.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-tool]")) setToolsOpen(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!tools.contains(e.target as Node)) setToolsOpen(false);
  });
  const brandTool = tools.querySelector(".brand-tool")!;

  // Заголовок группы подсвечен и показывает значок выбранного в ней инструмента
  app.onTool = (tool) => {
    const btn = tools.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
    if (btn) brandTool.textContent = (btn.textContent ?? "").replace(btn.querySelector("kbd")?.textContent ?? "", "").trim();
    for (const g of groups) {
      const chosen = g.querySelector<HTMLElement>(`.group-body [data-tool="${tool}"]`);
      const head = g.querySelector("summary")!;
      head.classList.toggle("active", !!chosen);
      head.title = chosen?.title ?? head.querySelector(".gname")!.textContent!;
      const icon = (chosen ?? g.querySelector<HTMLElement>(".group-body [data-tool]"))?.querySelector("svg")?.cloneNode(true);
      if (icon) head.querySelector("svg")!.replaceWith(icon);
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
  $("btn-sch-close").addEventListener("click", () => {
    setSchematic(false);
    setFull(false);
  });
  $("btn-sch-reset").addEventListener("click", () => app.resetSchematicLayout());
  // На весь экран и обратно (кнопка или Esc)
  const fullBtn = $("btn-sch-full");
  const setFull = (on: boolean) => {
    $("schematic").classList.toggle("full", on);
    fullBtn.setAttribute("aria-pressed", String(on));
    fullBtn.textContent = on ? "↙ Свернуть" : "⛶ Весь экран";
  };
  fullBtn.addEventListener("click", () => setFull(!$("schematic").classList.contains("full")));
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && $("schematic").classList.contains("full")) {
        setFull(false);
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  const zoomBtn = $("btn-sch-zoom");
  zoomBtn.addEventListener("click", () => {
    const actual = $("schematic").classList.toggle("actual");
    zoomBtn.setAttribute("aria-pressed", String(actual));
  });

  // «Проекты» — панель справа
  $("btn-menu").addEventListener("click", () => app.openMenu());
  $("btn-map").addEventListener("click", () => app.openMap());
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
      // Песочница — пустой стол; уровень карьеры — чистый корпус; мастерская — пустые платы
      app.clearTable();
      return;
    }
    clear.textContent = "Точно очистить?";
    armed = setTimeout(() => {
      armed = undefined;
      clear.textContent = "Очистить";
    }, 3000);
  });

  const loop = () => {
    // Следующий кадр планируем в любом случае: ошибка в одном кадре не должна останавливать страницу
    requestAnimationFrame(loop);
    try {
      app.frame();
    } catch (e) {
      console.error(e);
    }
  };
  loop();

  // Для отладки и автоматических проверок
  (window as unknown as { maketka: App }).maketka = app;
}

start();
