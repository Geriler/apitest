import { App } from "./app";
import { demoScene } from "./demo";
import { World } from "./view/world";

async function start(): Promise<void> {
  // Шрифты нужны до отрисовки текстур с подписями; ждём не дольше 1,5 с.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

  const $ = (id: string) => document.getElementById(id)!;
  const world = new World($("stage"));
  const saved = App.load();
  const app = new App(world, { inspector: $("inspector"), hint: $("hint"), toasts: $("toasts"), tools: $("tools") }, saved ?? demoScene());
  if (!saved) {
    app.toast("Это пример", "Замкните тумблер SA2 (нажмите на него дважды): резистор R2 22 Ом не выдержит мощности и сгорит. Потом выберите R2 и поставьте номинал побольше.");
  }

  $("btn-demo").addEventListener("click", () => app.replaceScene(demoScene()));
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
