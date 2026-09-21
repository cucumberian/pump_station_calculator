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
function padNum(v) { return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : v; }
function fmt(x, d = 2) { return Number(x).toFixed(Math.max(2, d)); }
const smartRound = v => (Math.abs(v) > 0 && Math.abs(v) < 0.01 ? +v.toPrecision(2) : +v.toFixed(2));
function openHelp() {}
function render() {}
`;

function loadModule(env) {
  const src = readSrc("reference-data.js") + readSrc("cascade-catch.js") +
    readSrc("cascade-rain.js") + PRELUDE + readSrc("single-catch.js");
  const body = new Function("document", "localStorage", "location", "window", "Event",
    src + `
return { catchState, CATCH_DEFAULTS, singleCatchCalc, singleCatchData, catchUrlParams,
  catchUrlLoad, recompute, activeRain, getActiveRain, rainProfiles, SURFACE_TYPES };
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

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
