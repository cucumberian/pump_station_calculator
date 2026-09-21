"use strict";

// Конверт kns-param: сборка, разбор, версии интерфейса и маршрутизация
// вставки по зарегистрированным приёмникам.

const fs = require("fs");
const path = require("path");
const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");

const alerts = [];
const M = new Function("alert",
  readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("param-transfer.js") + readSrc("cascade-rain.js") + `
return { paramEnvelope, parseParamEnvelope, applyParamEnvelope, pasteParamText, paramDataOf,
  normalizeParamData, registerParamTarget, PARAM_TARGETS, PARAM_FORMAT, PARAM_FORMAT_VERSION, paramToastText };
`,
)(msg => alerts.push(msg));

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
function lastAlert() { return alerts[alerts.length - 1] || ""; }

const CATCH = { F: 3.9, zMid: 0.201, psiMid: 0.634, tcon: 3, tcan: 7, tp: 0,
  segs: [], trays: [], coeffMode: "variable", coeffSource: "manual", zRows: [] };

test("конверт: round-trip без потерь", () => {
  const env = M.paramEnvelope("catch", CATCH, { name: "Водосбор 1" });
  eq(env.format, "kns-param");
  eq(env.kind, "catch");
  eq(env.typeVersion, 3);
  const back = M.parseParamEnvelope(JSON.stringify(env));
  ok(!back.error, `разбор не удался: ${back.error}`);
  eq(back.data.F, 3.9);
  ok(back.migrated === false, "текущая версия помечена как миграция");
});

test("конверт: чужой текст и чужой format отклоняются", () => {
  ok(M.parseParamEnvelope("привет").error, "произвольный текст принят");
  ok(M.parseParamEnvelope("{}").error, "пустой объект принят");
  ok(M.parseParamEnvelope(JSON.stringify({ format: "kns-cascade", nodes: [] })).error,
    "схема каскада принята за параметры ноды");
});

test("конверт: неизвестный kind отклоняется", () => {
  const r = M.parseParamEnvelope(JSON.stringify({ format: "kns-param", version: 1, kind: "неттакого", typeVersion: 1, data: {} }));
  ok(r.error?.includes("неизвестный тип"), `неожиданная ошибка: ${r.error}`);
});

test("версии: более новая версия интерфейса отклоняется с пояснением", () => {
  const env = { ...M.paramEnvelope("catch", CATCH), typeVersion: 4 };
  const r = M.parseParamEnvelope(JSON.stringify(env));
  ok(r.error, "новая версия принята");
  ok(r.error.includes("более новой"), `нет пояснения про версию: ${r.error}`);
  ok(r.error.includes("v4") && r.error.includes("v3"), `нет номеров версий: ${r.error}`);
});

test("версии: более новый формат конверта отклоняется", () => {
  const env = { ...M.paramEnvelope("catch", CATCH), version: 99 };
  const r = M.parseParamEnvelope(JSON.stringify(env));
  ok(r.error?.includes("формат"), `неожиданная ошибка: ${r.error}`);
});

test("версии: старая версия помечается миграцией и конвертируется", () => {
  const old = { format: "kns-param", version: 1, kind: "catch", typeVersion: 2,
    data: { l1: 68, v1: 0.7, l2: 133, v2: 1.0, tcan: 5 } };
  const r = M.parseParamEnvelope(JSON.stringify(old));
  ok(!r.error, `старая версия отклонена: ${r.error}`);
  ok(r.migrated === true && r.fromVersion === 2, "миграция не отмечена");
  eq(r.data.segs, [{ l: 68, v: 0.7 }, { l: 133, v: 1 }], "legacy-участки не перенесены");
});

test("битое значение в поле: отказ с подписью поля, без вставки", () => {
  const env = { ...M.paramEnvelope("rain", { q20: 80 }), data: { q20: "abc" } };
  const r = M.parseParamEnvelope(JSON.stringify(env));
  ok(r.error?.includes("q₂₀"), `нет подписи поля: ${r.error}`);
});

test("paramDataOf: отбрасывает поля вне интерфейса, оставляет наследие", () => {
  const d = M.paramDataOf("catch", { ...CATCH, мусор: 1, coeffSource: "manual", q20: 80 });
  ok(!("мусор" in d), "чужое поле попало в конверт");
  ok("q20" in d, "поле схемы потеряно");
  eq(d.segs, [], "segs потерян");
});

test("normalizeParamData: дождь нормализуется normRain (район, n)", () => {
  const r = M.normalizeParamData("rain", { q20: "100", n: "0.5", district: 4 });
  eq(r.q20, 100);
  eq(r.n, 0.5);
  eq(r.district, 4);
});

test("вставка: маршрутизируется в приёмник своего типа", () => {
  let got = null;
  M.registerParamTarget("catch", { paste: (data, ctx) => { got = { data, ctx }; return true; } });
  const env = M.paramEnvelope("catch", CATCH);
  const okPaste = M.pasteParamText(JSON.stringify(env), { mode: "into" });
  ok(okPaste, "вставка не выполнена");
  eq(got.data.F, 3.9);
  eq(got.ctx, { mode: "into" });
});

test("вставка: чужой тип даёт сообщение о несовместимости", () => {
  alerts.length = 0;
  const env = M.paramEnvelope("delay", { v: 1, l: 100 });
  const okPaste = M.pasteParamText(JSON.stringify(env), {});
  ok(okPaste === false, "несовместимая вставка не отклонена");
  ok(lastAlert().includes("Участок сети") && lastAlert().includes("нельзя"),
    `неожиданное сообщение: ${lastAlert()}`);
});

test("вставка: успех показывается тостом, а не системной модалкой", () => {
  alerts.length = 0;
  M.registerParamTarget("catch", { paste: () => true });
  ok(M.pasteParamText(JSON.stringify(M.paramEnvelope("catch", CATCH)), {}), "вставка не выполнена");
  eq(alerts, [], "на успех показан alert — должны быть только тосты");
  ok(M.paramToastText().includes("параметры вставлены"), `неожиданный тост: ${M.paramToastText()}`);
});

test("вставка: миграция сообщается тостом с номерами версий", () => {
  alerts.length = 0;
  M.registerParamTarget("pump", { paste: () => true });
  const env = { format: "kns-param", version: 1, kind: "pump", typeVersion: 1, data: { Qr: 300, Q: 150 } };
  ok(M.pasteParamText(JSON.stringify(env), {}), "вставка не выполнена");
  ok(M.paramToastText().includes("v1") && M.paramToastText().includes("v2"),
    `нет сообщения о конвертации: ${M.paramToastText()}`);
  eq(alerts, [], "миграция показана alert'ом вместо тоста");
});

test("вставка: ошибка остаётся alert'ом (её нельзя пропустить)", () => {
  alerts.length = 0;
  ok(M.pasteParamText("не параметры", {}) === false, "мусор принят");
  ok(alerts.length === 1 && alerts[0].includes("Не удалось вставить"), `неожиданный alert: ${alerts[0]}`);
});

test("вставка: приёмник вернул false — ни тоста, ни подтверждения", () => {
  alerts.length = 0;
  const before = M.paramToastText();
  M.registerParamTarget("flow", { paste: () => false });
  M.pasteParamText(JSON.stringify(M.paramEnvelope("flow", { q: 10 })), {});
  eq(alerts, [], "показан ложный alert");
  eq(M.paramToastText(), before, "показан ложный тост");
});

test("дождь: приёмник зарегистрирован cascade-rain.js", () => {
  ok(M.PARAM_TARGETS.rain?.copy, "нет приёмника дождя");
  const got = M.PARAM_TARGETS.rain.copy();
  ok(got.data.q20 > 0 && typeof got.data.n === "number", "копирование дождя вернуло не то");
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
