// Собирает dist/index.html в один HTML-фрагмент для публикации как Artifact:
// без <!doctype>/<html>/<head>/<body> (их добавляет хостинг), скрипт встроен в страницу.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync("dist/index.html", "utf8");
const scriptTag = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
if (!scriptTag) throw new Error("Не найден тег скрипта в dist/index.html");
const code = readFileSync(join("dist", scriptTag[1]), "utf8").replace(/<\/script/gi, "<\\/script");
if (/<link[^>]+href="\.\/assets\//.test(html)) throw new Error("Есть внешний CSS из сборки — его тоже надо встроить");

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(scriptTag[0], "").replace(/<meta charset[^>]*>\s*/, "").replace(/<meta name="viewport"[^>]*>\s*/, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const out = `${head.trim()}\n${body.trim()}\n<script type="module">\n${code}\n</script>\n`;
mkdirSync("dist-artifact", { recursive: true });
writeFileSync("dist-artifact/index.html", out);
console.log(`dist-artifact/index.html: ${(out.length / 1024).toFixed(0)} КБ`);
