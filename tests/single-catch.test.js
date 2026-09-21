"use strict";

// Одиночный расчёт: дождь и водосбор считают те же функции, что и каскад,
// и на дефолтах страницы воспроизводят контрольный пример ВОДГЕО (2006):
// A ≈ 671 л/(с·га), t_r = 10 мин, Qr ≈ 342 л/с. Плюс режим «по водосбору»
// подставляет рассчитанные Qr/tr в поля, round-trip через адрес и то, что
// старые сохранённые параметры не начинают вдруг считаться по-новому.

const fs = require("fs");
const path = require("path");
const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");

// ---- DOM-моки: реестр элементов, значения круговые ----
function makeEnv(seed = {}) {
  const registry = new Map();
  function el(id) {
    if (!registry.has(id)) {
      registry.set(id, {
        id, value: seed[id] != null ? String(seed[id]) : "", hidden: false,
        readOnly: false, disabled: false, title: "", innerHTML: "", textContent: "",
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.remove(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        dataset: {}, style: {},
        listeners: {},
        addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
        dispatchEvent() {},
        append() {}, appendChild() {}, focus() {}, click() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        closest() { return null; },
      });
    }
    return registry.get(id);
  }
  const radios = {};
  function radioGroup(name, values) {
    return (radios[name] ||= values.map(v => ({ value: v, checked: false, addEventListener() {} })));
  }
  const doc = {
    getElementById: el,
    createElement: () => ({ className: "", dataset: {}, innerHTML: "", style: {}, append() {}, addEventListener() {}, setAttribute() {} }),
    addEventListener(t, fn) { (this.listeners ||= {})[t] = fn; },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll(sel) {
      const m = /input\[name="([^"]+)"\]/.exec(sel);
      if (m) {
        const groups = { qrMode: ["catch", "manual"], catchCoeff: ["variable", "const"], catchSource: ["manual", "table"] };
        return radioGroup(m[1], groups[m[1]] || []);
      }
      return [];
    },
  };
  const store = new Map(seed.storage || []);
  return {
    el, doc, store, radios, registry,
    globals: {
      document: doc,
      location: { search: seed.search || "" },
      localStorage: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
      },
      Event: class Event { constructor(t) { this.type = t; } },
      window: { addEventListener() {}, innerWidth: 1280, matchMedia: () => ({ matches: true }) },
    },
  };
}

const PRELUDE = `
function openHelp() {}
function render() {}
`;

function loadModule(env) {
  // calc-view.js подключаем целиком: padNum/fmt/smartRound/derivedTitle —
  // настоящие, а не копия в тесте.
  const src = readSrc("hydro.js") + readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("param-transfer.js") +
    readSrc("calc-view.js") + readSrc("cascade-catch.js") + readSrc("cascade-rain.js") +
    readSrc("share-code.js") +
    PRELUDE + readSrc("single-catch.js");
  const body = new Function("document", "localStorage", "location", "window", "Event",
    src + `
return { catchState, CATCH_DEFAULTS, singleCatchCalc, singleCatchData, catchUrlParams,
  catchUrlLoad, recompute, activeRain, getActiveRain, rainProfiles, SURFACE_TYPES,
  cascadeImportPayload, encodeSharePayload, decodeSharePayload,
  getDerived: () => singleCatchDerived, derivedTitle, derivedTitleMany, calc };
`);
  return body(env.globals.document, env.globals.localStorage, env.globals.location,
    env.globals.window, env.globals.Event);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}
function approx(a, b, tol = 1e-9) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`ожидалось ${b}, получено ${a} (допуск ${tol})`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "значения разошлись"}: получено ${JSON.stringify(a)}, ожидалось ${JSON.stringify(b)}`);
}

const SEED = { n: "0.71", Qr: "342.30", tr: "10.00" };

test("дождь: профиль по умолчанию и параметр A контрольного примера", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  const r = M.activeRain();
  approx(r.q20, 80); approx(r.P, 1); approx(r.mr, 150); approx(r.gamma, 1.54); approx(r.n, 0.71);
  approx(rainA(r), 80 * 20 ** 0.71, 1e-9); // lg P = 0 → множитель (1 + 0)^γ = 1
});
function rainA(r) { return r.q20 * 20 ** r.n * (1 + Math.log(r.P) / Math.log(r.mr)) ** r.gamma; }

test("водосбор на дефолтах: t_r = 10 мин и Qr контрольного примера ВОДГЕО", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  const { p } = M.singleCatchCalc({ data: M.catchState.data });
  approx(p.tr, 10, 1e-12);
  approx(p.A, 671.147, 1e-2);
  approx(p.Qr, 342.3, 1.0); // 342,3 в примере — округление z_mid до 0,201
  approx(p.zMid, 0.201); approx(p.psiMid, 0.634); approx(p.F, 3.9);
});

test("одиночный водосбор совпадает с каскадным catchParams на тех же данных", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  const data = { ...M.CATCH_DEFAULTS, coeffSource: "manual", tcan: 0, tp: 0, tcon: 4 };
  const { p } = M.singleCatchCalc({ data });
  const direct = catchParamsDirect(data, 0.71, M.activeRain());
  approx(p.Qr, direct.Qr, 1e-12);
  approx(p.tr, direct.tr, 1e-12);
  approx(p.tr, 4, 1e-12);
});
function catchParamsDirect(d, n, rain) {
  const env2 = makeEnv(SEED);
  const f = new Function("document", "localStorage", "location", "window", "Event",
    readSrc("reference-data.js") + readSrc("cascade-catch.js") + "return catchParams;");
  return f(env2.globals.document, env2.globals.localStorage, env2.globals.location,
    env2.globals.window, env2.globals.Event)(d, n, rain);
}

test("режим «по водосбору» подставляет рассчитанные Qr и tr в поля", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  ok(M.catchState.mode === "catch", "на чистой странице режим должен быть «по водосбору»");
  M.recompute();
  const p0 = M.singleCatchCalc({ data: M.catchState.data }).p;
  approx(parseFloat(env.el("Qr").value), Math.round(p0.Qr * 100) / 100, 1e-9);
  approx(parseFloat(env.el("tr").value), 10, 1e-9);
  ok(env.el("Qr").readOnly, "в автоматическом режиме Qr должен быть только для чтения");
  ok(env.el("rainFormula").innerHTML.includes("671"), "в панели дождя нет параметра A");
  ok(env.el("catchOut").innerHTML.includes("342"), "в панели водосбора нет Qr");
});

test("режим «вручную» не трогает поля пользователя", () => {
  const env = makeEnv({ ...SEED, Qr: "123.00", tr: "7.00", storage: [["kns-single-catch", JSON.stringify({ mode: "manual", rain: {}, data: {} })]] });
  const M = loadModule(env);
  ok(M.catchState.mode === "manual", "сохранённый режим не восстановлен");
  M.recompute();
  approx(parseFloat(env.el("Qr").value), 123, 1e-9);
  approx(parseFloat(env.el("tr").value), 7, 1e-9);
  ok(env.el("Qr").readOnly === false, "в ручном режиме поле должно редактироваться");
});

test("старые сохранённые параметры не начинают считаться по водосбору", () => {
  const env = makeEnv({ ...SEED, storage: [["kns-params", JSON.stringify({ Qr: "200", tr: "12", n: "0.71" })]] });
  const M = loadModule(env);
  ok(M.catchState.mode === "manual", "легаси-пользователь должен остаться в ручном режиме");
});

test("адрес: round-trip дождя и водосбора через catchUrlParams / catchUrlLoad", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  M.catchState.data = { ...M.CATCH_DEFAULTS, coeffSource: "table", F: 0, tcan: 0, tp: 0,
    zRows: [{ type: "imp", F: 2.5, z: "" }, { type: "lawn", F: 1.4, z: "" }],
    segs: [{ l: 400, v: 1.2 }], trays: [{ l: 120, v: 0.8 }] };
  M.rainProfiles[0].q20 = 100;
  M.rainProfiles[0].district = 4;
  const p = new URLSearchParams();
  M.catchUrlParams(p);
  ok(p.get("c.q20") === "100", "q₂₀ не попала в адрес");
  ok(p.get("c.coeffSource") === "table", "источник коэффициентов не попал в адрес");

  const env2 = makeEnv(SEED);
  const M2 = loadModule(env2);
  const loaded = new URLSearchParams(p.toString());
  ok(M2.catchUrlLoad(loaded), "адрес не распознан");
  approx(M2.rainProfiles[0].q20, 100);
  ok(M2.rainProfiles[0].district === 4, "район Ж.1 не восстановлен");
  approx(M2.catchState.data.F, 0);
  const { p: res } = M2.singleCatchCalc({ data: M2.catchState.data });
  approx(res.areaSum, 3.9, 1e-12);
  approx(res.F, 3.9, 1e-12);
  // t_p = 0,017·(400/1,2); t_can = 0,021·(120/0,8)
  approx(res.tp, 0.017 * 400 / 1.2, 1e-9);
  approx(res.tcan, 0.021 * 120 / 0.8, 1e-9);
  approx(res.tr, 3 + res.tcan + res.tp, 1e-9);
  ok(!loaded.has("c.zRows") || loaded.get("c.zRows").includes("lawn"), "состав поверхностей не попал в адрес");
});

test("пустые заготовки строк в адрес не попадают", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  M.catchState.data = { ...M.CATCH_DEFAULTS, segs: [{ l: "", v: "" }], trays: [{ l: 100, v: "" }] };
  const p = new URLSearchParams();
  M.catchUrlParams(p);
  ok(!p.has("c.segs"), "пустой участок сети попал в адрес");
  ok(!p.has("c.trays"), "неполный участок лотка попал в адрес");
});

test("водосбор с нулевой площадью честно сообщает причину Qr = 0", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  M.catchState.data = { ...M.CATCH_DEFAULTS, F: 0 };
  M.recompute();
  ok(env.el("catchOut").innerHTML.includes("нулевая площадь"), `неожиданная причина: ${env.el("catchOut").innerHTML}`);
});

test("ползунок n: обработчик вешается на DOMContentLoaded, а не раньше app.js", () => {
  const src = readSrc("single-catch.js");
  // Если повесить на верхнем уровне, наш render() откатит nrange.value до
  // того, как app.js прочитает новое значение, — ползунок не двигается.
  ok(!/^\$sc\("nrange"\)\.addEventListener/m.test(src),
    "nrange повешен на верхнем уровне — app.js не успеет прочитать значение");
  ok(/DOMContentLoaded[\s\S]{0,400}\$sc\("nrange"\)\.addEventListener/.test(src),
    "нет отложенной привязки обработчика nrange");
});

test("скролл: поля дождя и водосбора перечислены в WHEEL_STEPS", () => {
  const m = /const WHEEL_STEPS = \{([\s\S]*?)\};/.exec(readSrc("app.js"));
  ok(m, "WHEEL_STEPS не найден в app.js");
  for (const id of ["rainQ20", "rainP", "rainMr", "rainGamma", "catchF", "catchZ", "catchTcon"]) {
    ok(m[1].includes(id + ":"), `в WHEEL_STEPS нет ${id} — скролл по полю не работает`);
  }
});

test("подсказка: 6 знаков и единица измерения", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  eq(M.derivedTitle(10.051761904761907, "мин"), "точное значение: 10,051762 мин");
  eq(M.derivedTitle(0.8444476701971355, "мин"), "точное значение: 0,844448 мин");
  eq(M.derivedTitle(Number.NaN, "мин"), "");
  eq(M.derivedTitleMany([["Wнс", 112.3483604382589, "м³"], ["Tк", 120.19011550964575, "мин"]]),
    "точные значения: Wнс = 112,348360 м³, Tк = 120,190116 мин");
});

test("точность: расчёт КНС берёт точную пару, поля — витрина с точным в подсказке", () => {
  const env = makeEnv({ ...SEED, n: "0.4" });
  const M = loadModule(env);
  // Параметры дождя из отчёта: n = 0,4, q₂₀ = 40, m_r = 130, γ = 1,33.
  Object.assign(M.rainProfiles[0], { q20: 40, P: 1, mr: 130, gamma: 1.33 });
  M.catchState.data = {
    ...M.CATCH_DEFAULTS, coeffSource: "manual", tcon: 3, tcan: 0, tp: 0,
    segs: [{ l: 68, v: 0.7 }, { l: 133, v: 1 }, { l: 277, v: 1.5 }],
  };
  M.recompute();
  const { p } = M.singleCatchCalc({ data: M.catchState.data });
  // 10,051762 против 10,05 — тот самый случай, из-за которого расходились
  // одиночный расчёт и каскад.
  approx(p.tr, 10.051761904761907, 1e-9);
  approx(p.Qr, 114.91454944913622, 1e-9);
  const derived = M.getDerived();
  ok(derived, "точная пара для расчёта КНС не выставлена");
  approx(derived.tr, p.tr, 1e-12);
  approx(derived.Qr, p.Qr, 1e-12);
  approx(parseFloat(env.el("tr").value), 10.05, 1e-9);
  approx(parseFloat(env.el("Qr").value), 114.91, 1e-9);
  ok(env.el("tr").title.includes("10,051762"), `нет точного значения в подсказке: ${env.el("tr").title}`);
  ok(env.el("Qr").title.includes("114,914549"), `нет точного значения в подсказке: ${env.el("Qr").title}`);
});

test("точность: в ручном режиме производных значений нет", () => {
  const env = makeEnv({ ...SEED, storage: [["kns-single-catch", JSON.stringify({ mode: "manual", rain: {}, data: {} })]] });
  const M = loadModule(env);
  M.recompute();
  ok(M.getDerived() === null, "в ручном режиме расчёт не должен брать производные значения");
  eq(env.el("tr").title, "", "в ручном режиме подсказка про точное значение лишняя");
});

test("точность: точные Tн/Tк/Wнс совпадают с каскадными на тех же данных", () => {
  const env = makeEnv({ ...SEED, n: "0.4" });
  const M = loadModule(env);
  // Параметры дождя из отчёта: n = 0,4, q₂₀ = 40, m_r = 130, γ = 1,33.
  Object.assign(M.rainProfiles[0], { q20: 40, P: 1, mr: 130, gamma: 1.33 });
  M.catchState.data = {
    ...M.CATCH_DEFAULTS, coeffSource: "manual", tcon: 3, tcan: 0, tp: 0,
    segs: [{ l: 68, v: 0.7 }, { l: 133, v: 1 }, { l: 277, v: 1.5 }],
  };
  M.recompute();
  const { p } = M.singleCatchCalc({ data: M.catchState.data });
  approx(p.n, 0.4, 1e-12);
  approx(p.Qr, 114.91454944913622, 1e-9);
  const r = M.calc(26, p.Qr, p.tr, p.n);
  approx(r.W, 112.3483604382589, 1e-9);
  approx(r.tk, 120.19011550964575, 1e-9);
  // а по округлённым полям получалось 112,32 — то, что видел пользователь
  approx(M.calc(26, 114.91, 10.05, p.n).W, 112.31685142430513, 1e-9);
});

test("мост «В каскад»: автоматический режим — водосбор → КНС с дождём и Qнс", () => {
  const env = makeEnv(SEED);
  const M = loadModule(env);
  env.el("Q").value = "100";
  M.recompute();
  const payload = M.cascadeImportPayload();
  ok(payload.rains.length === 1 && payload.rains[0].id === 1, "дождь не перенесён");
  approx(payload.rains[0].q20, 80);
  approx(payload.n, 0.71);
  eq(payload.nodes.map(n => n.type).join(","), "catch,pump", "ожидались водосбор и КНС");
  eq(payload.connections.length, 1);
  eq(payload.connections[0].from, 1);
  eq(payload.connections[0].to, 2);
  const pump = payload.nodes.find(n => n.type === "pump");
  approx(pump.data.q, 100);
  const p = M.singleCatchCalc({ data: M.catchState.data }).p;
  approx(pump.data.qr, p.Qr, 1e-9);
  approx(pump.data.tr, p.tr, 1e-9);
});

test("мост «В каскад»: ручной режим — только КНС, без водосбора", () => {
  const env = makeEnv({ ...SEED, Qr: "123.00", tr: "7.00", Q: "100.00",
    storage: [["kns-single-catch", JSON.stringify({ mode: "manual", rain: {}, data: {} })]] });
  const M = loadModule(env);
  M.recompute();
  const payload = M.cascadeImportPayload();
  eq(payload.nodes.length, 1, "в ручном режиме водосбор не переносится");
  eq(payload.nodes[0].type, "pump");
  eq(payload.connections.length, 0);
  approx(payload.nodes[0].data.qr, 123);
  approx(payload.nodes[0].data.tr, 7);
});

// Ссылка #s=, которую открывает кнопка «В каскад»: общий кодек
// (share-code.js) должен давать код, который разбирает каскад.
(async () => {
  try {
    const env = makeEnv(SEED);
    const M = loadModule(env);
    env.el("Q").value = "100";
    const payload = M.cascadeImportPayload();
    const code = await M.encodeSharePayload(payload);
    ok(/^[dj]\.[A-Za-z0-9_-]+$/.test(code), "не base64url: " + code.slice(0, 24));
    const back = await M.decodeSharePayload(code);
    eq(back.nodes.map(n => n.type).join(","), "catch,pump");
    eq(back.connections.length, 1);
    approx(back.rains[0].q20, 80);
    passed++;
  } catch (e) {
    failed++;
    console.error(`\u2716 ${"ссылка одиночного расчёта кодируется и разбирается"}\n  ${e.stack || e.message}`);
  }
  console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
  process.exit(failed ? 1 : 0);
})();
