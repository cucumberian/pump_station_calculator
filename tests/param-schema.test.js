"use strict";

// Схема интерфейса параметров: дефолты выводятся из неё (регрессия после
// переноса NODE_DEFAULTS из cascade-nodes.js), версии типов на месте,
// validateAgainstSchema чистит чужие данные, справка строится из схемы.

const fs = require("fs");
const path = require("path");
const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");

const M = new Function(
  readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("cascade-nodes.js") + `
return { PARAM_SCHEMA, NODE_DEFAULTS, NODE_TYPES, nodeDefaultsOf, migrateNodeData,
  validateAgainstSchema, schemaHelpBlocks, schemaDefault, PARAM_FORMAT, PARAM_FORMAT_VERSION };
`,
)();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || "значения разошлись"}\n  получено:  ${sa}\n  ожидалось: ${sb}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// Историческая форма дефолтов — то, что было в cascade-nodes.js до переноса
// в схему. Любое расхождение меняет поведение нод и сохранённых схем.
const LEGACY_DEFAULTS = {
  pump: { name: "", desc: "", qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
  delay: { name: "", desc: "", v: 1, l: 3600, d: "" },
  flow: { name: "", desc: "", mode: "constant", q: 50, t1: "", t2: "" },
  catch: {
    name: "", desc: "", q20: 80, P: 1.0, mr: 150, gamma: 1.54,
    psiMid: 0.634, zMid: 0.201, F: 3.9, tcon: 3, tcan: 0, tp: 0,
    segs: [], trays: [], coeffMode: "variable", coeffSource: "table",
    zRows: M.PARAM_SCHEMA.catch.fields.zRows.default(),
  },
};

test("NODE_DEFAULTS, выведенные из схемы, совпадают с исторической формой", () => {
  for (const type of M.NODE_TYPES) {
    eq(M.NODE_DEFAULTS[type], LEGACY_DEFAULTS[type], `дефолты «${type}» разошлись`);
  }
  eq(Object.keys(M.NODE_DEFAULTS).sort(), M.NODE_TYPES.slice().sort(), "состав типов нод изменился");
});

test("списки в дефолтах — свежие объекты, а не общий массив", () => {
  const a = M.nodeDefaultsOf("catch"), b = M.nodeDefaultsOf("catch");
  ok(a.segs !== b.segs, "segs делят один массив между нодами");
  ok(a.zRows !== b.zRows, "zRows делят один массив между нодами");
  ok(a.zRows[0] !== b.zRows[0], "строки zRows делят один объект между нодами");
});

test("версии интерфейса зафиксированы", () => {
  eq(M.PARAM_SCHEMA.rain.version, 2);
  eq(M.PARAM_SCHEMA.pump.version, 2);
  eq(M.PARAM_SCHEMA.delay.version, 2);
  eq(M.PARAM_SCHEMA.catch.version, 3);
  eq(M.PARAM_SCHEMA.flow.version, 1);
  ok(M.PARAM_FORMAT === "kns-param" && M.PARAM_FORMAT_VERSION === 1, "формат конверта изменился");
});

test("catch: наследие дождя помечено legacy, чтобы не считалось интерфейсом", () => {
  for (const key of ["q20", "P", "mr", "gamma"]) {
    ok(M.PARAM_SCHEMA.catch.fields[key]?.legacy, `${key} не помечен legacy`);
  }
  for (const key of ["F", "zMid", "psiMid", "tcon"]) {
    ok(!M.PARAM_SCHEMA.catch.fields[key]?.legacy, `${key} не должен быть legacy`);
  }
});

test("validateAgainstSchema: чужие поля отброшены, числа из строк приведены", () => {
  const { data, errors } = M.validateAgainstSchema("catch", { F: "7.5", tcon: "2", мусор: 1, name: "В-1" });
  eq(errors, [], "неожиданные ошибки");
  eq(data, { name: "В-1", F: 7.5, tcon: 2 }, "данные приведены неверно");
});

test("validateAgainstSchema: нечисловое значение → ошибка с подписью поля", () => {
  const { errors } = M.validateAgainstSchema("rain", { q20: "abc" });
  ok(errors.length === 1, `ожидалась одна ошибка, получено ${errors.length}`);
  ok(errors[0].includes("q₂₀"), `в ошибке нет подписи поля: ${errors[0]}`);
  ok(errors[0].includes("число"), `в ошибке нет пояснения: ${errors[0]}`);
});

test("validateAgainstSchema: выход за границы и недопустимый вариант", () => {
  ok(M.validateAgainstSchema("rain", { n: 5 }).errors[0].includes("не больше"), "нет проверки максимума");
  ok(M.validateAgainstSchema("catch", { coeffMode: "zzz" }).errors[0].includes("допустимо"), "нет проверки enum");
  ok(M.validateAgainstSchema("catch", { segs: "нет" }).errors[0].includes("список"), "нет проверки списка");
});

test("validateAgainstSchema: список нормализуется построчно", () => {
  const { data, errors } = M.validateAgainstSchema("catch", { segs: [{ l: "100", v: "1.5" }] });
  eq(errors, []);
  eq(data.segs, [{ l: 100, v: 1.5 }]);
});

test("validateAgainstSchema: неизвестный тип — ошибка, а не падение", () => {
  const r = M.validateAgainstSchema("неттакого", {});
  ok(r.data === null && r.errors.length === 1, "неизвестный тип не отклонён");
});

test("migrateNodeData берёт дефолты из схемы (catch v2 → v3)", () => {
  const d = M.migrateNodeData("catch", { l1: 68, v1: 0.7, tcan: 5 });
  eq(d.segs, [{ l: 68, v: 0.7 }]);
  eq(d.F, 3.9); // дефолт из схемы
  ok(!("l1" in d) && !("v1" in d), "legacy-ключи остались");
  ok(d.coeffSource === "manual", "схема без coeffSource должна остаться ручной");
});

test("справка: версия и таблица полей строятся из схемы", () => {
  const blocks = M.schemaHelpBlocks("catch");
  const txt = JSON.stringify(blocks);
  ok(txt.includes("v3"), "в справке нет версии интерфейса");
  const table = blocks.find(b => b.table);
  ok(table, "нет таблицы полей");
  eq(table.table.head, ["Поле", "Тип", "Единица", "По умолчанию"]);
  ok(table.table.rows.length === Object.keys(M.PARAM_SCHEMA.catch.fields).length,
    `строк ${table.table.rows.length}, полей ${Object.keys(M.PARAM_SCHEMA.catch.fields).length}`);
  ok(txt.includes("га"), "в таблице нет единиц измерения");
});

test("справка без аргумента перечисляет все типы нод", () => {
  const txt = JSON.stringify(M.schemaHelpBlocks());
  for (const type of M.NODE_TYPES) ok(txt.includes(M.PARAM_SCHEMA[type].label), `нет типа «${type}»`);
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
