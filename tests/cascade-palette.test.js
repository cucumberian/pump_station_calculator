"use strict";

// Регрессия: перетаскивание нод из палитры сделано своим pointer-drag, а не
// нативным HTML5 DnD — у нативного drag-ghost в Chromium заметное отставание
// от курсора. Тест статический: проверяет, что нативный draggable выключен,
// обвязка pointer-drag на месте, а ghost-стили существуют.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "cascade.html"), "utf8");
const js = fs.readFileSync(path.join(root, "static/js/cascade.js"), "utf8");
const css = fs.readFileSync(path.join(root, "static/css/cascade.css"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.message}`); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

test("палитра: нативный draggable выключен, data-node сохранён", () => {
  const nodes = [...html.matchAll(/<div class="pal-node ([^"]+)"([^>]*)data-node="([^"]+)"/g)];
  ok(nodes.length === 4, `ожидалось 4 pal-node, найдено ${nodes.length}`);
  ok(!/draggable="true"/.test(html), "в разметке остался draggable=\"true\"");
  for (const [, cls, attrs, type] of nodes) {
    ok(["pump", "delay", "catch", "flow"].includes(type), `неизвестный data-node: ${type}`);
    ok(!/draggable/.test(attrs), `у ${cls} остался draggable`);
  }
});

test("обвязка pointer-drag присутствует в cascade.js", () => {
  for (const needle of [
    'addEventListener("pointerdown"',
    "palMove", "palUp", "palClearDrag",
    "palPointToCanvas", "PAL_DRAG_THRESHOLD",
    "item.draggable = false",
  ]) {
    ok(js.includes(needle), `в cascade.js нет: ${needle}`);
  }
  ok(!js.includes('addEventListener("dragstart"'), "остался нативный dragstart");
  ok(!js.includes('.getData("node")'), "осталось чтение dataTransfer");
});

test("ghost-стили и состояние перетаскивания есть в CSS", () => {
  ok(css.includes(".pal-ghost"), "нет .pal-ghost");
  ok(/\.pal-ghost\s*\{[^}]*position:\s*fixed/.test(css), "ghost не position: fixed");
  ok(/\.pal-ghost\s*\{[^}]*transform/.test(css) || css.includes("will-change: transform"),
    "ghost без transform/will-change (не композитится)");
  ok(css.includes("body.pal-dragging"), "нет body.pal-dragging");
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
