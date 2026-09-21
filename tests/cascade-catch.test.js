"use strict";

// Нода «Водосбор»: произвольные списки участков сети (ф. 7, 0,017·Σ(l/v)) и
// участков лотка (ф. 6, 0,021·Σ(l/v)), плюс миграция legacy-тройки l1/v1…l3/v3
// в массив segs — на реальном коде приложения.

const fs = require("fs");
const path = require("path");
const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");
const graphSrc = readSrc("cascade-graph.js");

const N = new Function("window",
  readSrc("hydro.js") + readSrc("calc-view.js") + readSrc("reference-data.js") + readSrc("cascade-nodes.js") + readSrc("cascade-catch.js") + `
return { catchParams, parseSections, catchHelp, catchTrHelp, catchCoeffHelp, catchSources, coeffModeBlocks,
  catchErrorReason, CATCH_SOURCES, fmt, impermeableZ, coeffTableBlocks, Z_TABLE_A, Z_TABLE_N, SURFACE_TYPES, SURFACE_BY_KEY,
  NODE_DEFAULTS, NODE_PORTS, NODE_HTML };
`)({ addEventListener() {} });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}
function approx(a, b, tol = 1e-9) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`ожидалось ${b}, получено ${a} (допуск ${tol})`);
}

const n = 0.71;
// Явный "manual" — большинство тестов ниже про ручные zMid/ψ_mid; дефолт
// ноды теперь "table" со всеми поверхностями (см. тест на дефолты).
const base = () => ({ ...N.NODE_DEFAULTS.catch, coeffSource: "manual" });

test("NODE_DEFAULTS.catch: режим «по составу» и все виды поверхностей с F = 0", () => {
  const d = N.NODE_DEFAULTS.catch;
  if (d.coeffSource !== "table") throw new Error("свежий водосбор должен считаться по составу поверхностей");
  if (d.zRows.length !== N.SURFACE_TYPES.length)
    throw new Error(`ожидалось ${N.SURFACE_TYPES.length} строк, получено ${d.zRows.length}`);
  d.zRows.forEach((r, i) => {
    if (r.type !== N.SURFACE_TYPES[i].key) throw new Error(`строка ${i}: вид ${r.type} вместо ${N.SURFACE_TYPES[i].key}`);
    if (r.F !== 0) throw new Error(`строка ${i}: площадь ${r.F} вместо 0`);
    if (r.z !== "") throw new Error(`строка ${i}: z должен быть пустым (авто по Ж.7)`);
  });
  // С нулевыми площадями нода честно просит задать площадь, а не считает мусор.
  const p = N.catchParams({ ...d }, n);
  approx(p.F, 0);
  approx(p.Qr, 0);
  const reason = N.catchErrorReason({ ...d });
  if (!reason.includes("не заданы площади")) throw new Error(`неожиданная причина: ${reason}`);
});

// ============================================================
// catchParams
// ============================================================

test("catchParams: пустые списки — tp = 0, t_can = ручное значение", () => {
  const p = N.catchParams({ ...base(), tcan: 4 }, n);
  approx(p.tp, 0);
  approx(p.tcanCalc, 0);
  approx(p.tcan, 4);
  approx(p.tr, p.tcon + 4);
});

test("catchParams: участки сети — tp = 0,017·Σ(l/v) (ф. 7)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 0, segs: [{ l: 100, v: 1 }, { l: 200, v: 2 }] }, n);
  approx(p.lvSum, 200);
  approx(p.tp, 0.017 * 200);
  approx(p.tr, 0.017 * 200);
});

test("catchParams: участки лотка — t_can = ручное + 0,021·Σ(l/v) (ф. 6)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 2, trays: [{ l: 100, v: 1 }, { l: 50, v: 0.5 }] }, n);
  approx(p.lvTraySum, 200);
  approx(p.tcanManual, 2);
  approx(p.tcanCalc, 0.021 * 200);
  approx(p.tcan, 2 + 0.021 * 200);
  approx(p.tr, p.tcan);
});

test("catchParams: добавочное время по трубам — tp = ручное + 0,017·Σ(l/v)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 0, tp: 3, segs: [{ l: 100, v: 1 }] }, n);
  approx(p.tpManual, 3);
  approx(p.tpCalc, 0.017 * 100);
  approx(p.tp, 3 + 1.7);
  approx(p.tr, p.tp);
});

test("catchParams: tp и t_can не пересекаются (сеть и лоток независимы)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 0, segs: [{ l: 100, v: 1 }], trays: [{ l: 100, v: 1 }] }, n);
  approx(p.tp, 0.017 * 100);
  approx(p.tcan, 0.021 * 100);
  approx(p.tr, 0.038 * 100);
});

test("parseSections: отбрасывает нулевые и мусорные, приводит к числам", () => {
  const s = N.parseSections([{ l: "10", v: "2" }, { l: 0, v: 1 }, { l: 5, v: 0 }, { l: "x", v: 1 }, null, { l: 3, v: "2" }]);
  if (s.length !== 2) throw new Error(`ожидалось 2 участка, получено ${s.length}`);
  approx(s[0].l, 10); approx(s[0].v, 2);
  approx(s[1].l, 3); approx(s[1].v, 2);
  if (N.parseSections(undefined).length !== 0) throw new Error("undefined должен давать пустой список");
});

test("catchHelp: содержит формулы (6) и (7) с коэффициентами", () => {
  const p = N.catchParams({ ...base(), segs: [{ l: 100, v: 1 }], trays: [{ l: 100, v: 1 }] }, n);
  if (!Number.isFinite(p.A)) throw new Error("catchParams потерял параметр A");
  const txt = JSON.stringify(N.catchHelp(p));
  if (!txt.includes("0{,}021")) throw new Error("нет коэффициента 0,021 для лотков");
  if (!txt.includes("0{,}017")) throw new Error("нет коэффициента 0,017 для труб");
  if (!txt.includes("A = q_{20}")) throw new Error("нет формульной подстановки A");
});

test("catchTrHelp: только t_r — сумма с подстановкой, без A и Q_r", () => {
  const p = N.catchParams({ ...base(), tcon: 3, tcan: 2, tp: 4, segs: [{ l: 100, v: 1 }], trays: [{ l: 50, v: 0.5 }] }, n);
  const txt = JSON.stringify(N.catchTrHelp(p));
  if (!txt.includes("t_r = t_{con}")) throw new Error("нет итоговой формулы t_r");
  if (!txt.includes("0{,}021")) throw new Error("нет формулы лотков (16)");
  if (!txt.includes("0{,}017")) throw new Error("нет формулы труб (17)");
  if (!txt.includes("+ 2,0")) throw new Error("нет ручной добавки t_can");
  if (!txt.includes("+ 4,0")) throw new Error("нет ручной добавки t_p");
  if (txt.includes("A = q_{20}")) throw new Error("в справке t_r не должно быть параметра A");
  if (txt.includes("Q_r =")) throw new Error("в справке t_r не должно быть Q_r");
});

// ============================================================
// z_mid / ψ_mid по составу поверхностей (табл. Ж.6, Ж.7)
// ============================================================

test("impermeableZ: интерполяция по A и ветка по n (Ж.7)", () => {
  // n ≥ 0,65: между 600 (0,29) и 700 (0,28)
  approx(N.impermeableZ(671.15, 0.71).z, 0.29 - 0.01 * 0.7115, 1e-9);
  // n < 0,65: края и зажим диапазона
  approx(N.impermeableZ(300, 0.6).z, 0.32);
  approx(N.impermeableZ(1500, 0.6).z, 0.23);
  approx(N.impermeableZ(100, 0.71).z, 0.33);       // ниже 300 — зажим
  approx(N.impermeableZ(9999, 0.71).z, 0.24);      // выше 1500 — зажим
  if (!N.impermeableZ(100, 0.71).outOfRange) throw new Error("A<300 должен помечаться вне диапазона");
  if (N.impermeableZ(671, 0.71).outOfRange) throw new Error("A внутри диапазона не должен помечаться");
});

test("z_mid/ψ_mid: пример ВОДГЕО (2,45 га imp + 1,45 га газонов)", () => {
  const d = {
    ...base(), coeffSource: "table",
    zRows: [{ type: "imp", F: 2.45, z: 0.297 }, { type: "lawn", F: 1.45 }],
  };
  const p = N.catchParams(d, n);
  if (!p.useTable) throw new Error("useTable должен быть true");
  approx(p.F, 3.9, 1e-9);
  approx(p.zMid, (2.45 * 0.297 + 1.45 * 0.038) / 3.9, 1e-9);
  approx(p.psiMid, (2.45 * 0.95 + 1.45 * 0.1) / 3.9, 1e-9);
});

test("z_mid: авто-подстановка z для imp по A/n, ψ — константа 0,95", () => {
  const d = { ...base(), coeffSource: "table", zRows: [{ type: "imp", F: 2.45 }, { type: "lawn", F: 1.45 }] };
  const p = N.catchParams(d, n);
  const zAuto = N.impermeableZ(p.A, n).z;
  approx(p.surfaces[0].z, zAuto, 1e-9);
  if (p.surfaces[0].zManual) throw new Error("без override zManual должен быть false");
  approx(p.surfaces[0].psi, 0.95);
  approx(p.zMid, (2.45 * zAuto + 1.45 * 0.038) / 3.9, 1e-9);
});

test("z_mid: F = ΣFᵢ, ручное F игнорируется; пустые/нулевые строки не мешают", () => {
  const d = {
    ...base(), F: 99, coeffSource: "table",
    zRows: [{ type: "lawn", F: 0 }, { type: "pav", F: 4 }],
  };
  const p = N.catchParams(d, n);
  approx(p.F, 4, 1e-9);
  approx(p.zMid, 0.224, 1e-9);
  approx(p.psiMid, 0.6, 1e-9);
});

test("z_mid: пустой состав в режиме table даёт нули, без отката на ручные", () => {
  const p = N.catchParams({ ...base(), coeffSource: "table", zRows: [], zMid: 0.15, psiMid: 0.4, F: 7.7 }, n);
  if (!p.useTable) throw new Error("в режиме table useTable должен быть true");
  approx(p.areaSum, 0);
  approx(p.F, 0);
  approx(p.zMid, 0);
  approx(p.psiMid, 0);
  approx(p.Qr, 0);
});

test("catchErrorReason: пустой состав vs заполненный", () => {
  const empty = N.catchErrorReason({ coeffSource: "table", zRows: [] });
  if (!empty.includes("не заданы площади")) throw new Error("нет причины про отсутствующие площади");
  const rows = N.catchErrorReason({ coeffSource: "table", zRows: [{ type: "lawn", F: 2 }] });
  if (rows.includes("не заданы площади")) throw new Error("при заданном составе причины про площади быть не должно");
  const manual = N.catchErrorReason({ coeffSource: "manual" });
  if (!manual) throw new Error("для manual причина должна быть общей (Qr = 0)");
  // Только нулевые площади — та же причина про площади.
  const zeros = N.catchErrorReason({ coeffSource: "table", zRows: [{ type: "imp", F: 0 }] });
  if (!zeros.includes("не заданы площади")) throw new Error("нулевые площади должны давать причину про площади");
});

test("ручной режим: явный 0 в F/z_mid/Ψ_mid не подменяется дефолтом", () => {
  const f0 = N.catchParams({ ...base(), coeffSource: "manual", F: 0 }, n);
  approx(f0.F, 0);
  approx(f0.Qr, 0);
  const z0 = N.catchParams({ ...base(), coeffSource: "manual", zMid: 0 }, n);
  approx(z0.zMid, 0);
  approx(z0.Qr, 0);
  const psi0 = N.catchParams({ ...base(), coeffSource: "manual", coeffMode: "const", psiMid: 0 }, n);
  approx(psi0.psiMid, 0);
  approx(psi0.Qr, 0);
});

test("catchErrorReason: ручной режим называет нулевую площадь/коэффициент", () => {
  if (!N.catchErrorReason({ coeffSource: "manual", F: 0 }).includes("площад"))
    throw new Error("нет причины про нулевую площадь");
  if (!N.catchErrorReason({ coeffSource: "manual", coeffMode: "variable", zMid: 0 }).includes("z_mid"))
    throw new Error("нет причины про нулевой z_mid");
  if (!N.catchErrorReason({ coeffSource: "manual", coeffMode: "const", psiMid: 0 }).includes("Ψ_mid"))
    throw new Error("нет причины про нулевой Ψ_mid");
});

// Переходы «вручную» ↔ «по составу»: ручной ноль не должен «протекать» в
// табличный режим и наоборот (см. регрессию: ручной F = 0 + переключение).
const ROWS = [{ type: "imp", F: 2.45, z: 0.297 }, { type: "lawn", F: 1.45 }];

test("переход manual(F=0) → table с составом: F = ΣFᵢ, ручной 0 игнорируется", () => {
  const p = N.catchParams({ ...base(), coeffSource: "table", F: 0, zRows: ROWS }, n);
  approx(p.areaSum, 3.9, 1e-9);
  approx(p.F, 3.9, 1e-9);
  if (!(p.Qr > 0)) throw new Error("Qr должен быть > 0");
  const reason = N.catchErrorReason({ coeffSource: "table", F: 0, zRows: ROWS });
  if (reason.includes("площад")) throw new Error("в table причина не должна быть про ручную площадь");
  if (reason.includes("поверхности")) throw new Error("состав задан — нет причины про поверхности");
});

test("переход manual(F=0) → table без состава: F = 0 и причина про площади", () => {
  const p = N.catchParams({ ...base(), coeffSource: "table", F: 0, zRows: [] }, n);
  approx(p.F, 0);
  approx(p.Qr, 0);
  const reason = N.catchErrorReason({ coeffSource: "table", F: 0, zRows: [] });
  if (!reason.includes("не заданы площади")) throw new Error("ожидалась причина про площади, а не про ручную площадь");
});

test("переход table(состав) → manual(F=0): считается ручной ноль", () => {
  const p = N.catchParams({ ...base(), coeffSource: "manual", F: 0, zRows: ROWS }, n);
  approx(p.F, 0);
  approx(p.Qr, 0);
  if (!N.catchErrorReason({ coeffSource: "manual", F: 0, zRows: ROWS }).includes("площад"))
    throw new Error("в ручном режиме причина должна быть про нулевую площадь");
});

test("переход table(состав) → manual(F>0): возврат к ручной площади", () => {
  const p = N.catchParams({ ...base(), coeffSource: "manual", F: 7.5, zRows: ROWS }, n);
  approx(p.F, 7.5);
  if (!(p.Qr > 0)) throw new Error("Qr должен быть > 0");
  if (N.catchErrorReason({ coeffSource: "manual", F: 7.5, zRows: ROWS }).includes("площад"))
    throw new Error("при F > 0 причины про площадь быть не должно");
});

test("phantom f=0 (нижний регистр от Drawflow) не подменяет F в table", () => {
  const p = N.catchParams({ ...base(), coeffSource: "table", F: 0, f: 0, zRows: ROWS }, n);
  approx(p.F, 3.9, 1e-9);
  const p2 = N.catchParams({ ...base(), coeffSource: "table", F: 0, f: 0, zRows: [{ type: "lawn", F: 5 }] }, n);
  approx(p2.F, 5, 1e-9);
});

test("table без состава: F = 0 и коэффициенты не подменяются ручными", () => {
  const p = N.catchParams({ ...base(), coeffSource: "table", zRows: [] }, n);
  approx(p.F, 0);
  approx(p.zMid, 0);
  approx(p.psiMid, 0);
  approx(p.Qr, 0);
});

test("z_mid: предупреждение при ΣF > 150 га", () => {
  const p = N.catchParams({ ...base(), coeffSource: "table", zRows: [{ type: "lawn", F: 200 }] }, n);
  if (!p.areaOver) throw new Error("ΣF > 150 га должен помечаться");
});

test("table: F = ΣFᵢ, а z_mid/Ψ_mid — средневзвешенные по тому же составу", () => {
  const d = {
    ...base(), coeffSource: "table",
    zRows: [{ type: "imp", F: 2.45, z: 0.297 }, { type: "lawn", F: 1.45 }],
  };
  const p = N.catchParams(d, n);
  approx(p.areaSum, 3.9, 1e-9);
  approx(p.F, 3.9, 1e-9);
  approx(p.zMid, (2.45 * 0.297 + 1.45 * 0.038) / 3.9, 1e-9);
  approx(p.psiMid, (2.45 * 0.95 + 1.45 * 0.1) / 3.9, 1e-9);
});

test("catchCoeffHelp: общая формула вручную и подстановка в режиме table", () => {
  const manual = N.catchParams({ ...base(), zMid: 0.201, psiMid: 0.634 }, n);
  const mtxt = JSON.stringify(N.catchCoeffHelp(manual));
  if (!mtxt.includes("z_{mid}")) throw new Error("нет общей формулы z_mid");
  if (!mtxt.includes("Ж.6")) throw new Error("нет ссылки на Ж.6");
  if (!mtxt.includes("вручную")) throw new Error("нет пояснения про ручной режим");

  const p = N.catchParams({
    ...base(), coeffSource: "table",
    zRows: [{ type: "imp", F: 2.45, z: 0.297 }, { type: "lawn", F: 1.45 }],
  }, n);
  const txt = JSON.stringify(N.catchCoeffHelp(p));
  if (!txt.includes("z_{mid}")) throw new Error("нет формулы z_mid");
  if (!txt.includes("\\Psi_{mid}")) throw new Error("нет формулы ψ_mid");
  if (!txt.includes("Ж.7")) throw new Error("нет ссылки на Ж.7");
  if (!txt.includes("F = \\\\sum F_i")) throw new Error("нет подстановки F = ΣFᵢ");
  const full = JSON.stringify(N.catchHelp(p));
  if (!full.includes("Ж.6")) throw new Error("в общей справке нет ссылки на Ж.6");
});

test("catchCoeffHelp: выбор коэффициента — обе формулы, определения и правило 30–40 %", () => {
  const p = N.catchParams({ ...base(), coeffMode: "variable" }, n);
  const txt = JSON.stringify(N.catchCoeffHelp(p));
  if (!txt.includes("(20)")) throw new Error("нет ссылки на формулу (20) — переменный коэффициент");
  if (!txt.includes("(12)")) throw new Error("нет ссылки на формулу (12) — постоянный коэффициент");
  if (!txt.includes("A^{1{,}2}")) throw new Error("нет переменной формулы с A^1,2");
  if (!txt.includes("1{,}2n")) throw new Error("нет показателя 1,2n−0,1");
  if (!txt.includes("А.25") || !txt.includes("А.26")) throw new Error("нет определений А.25/А.26");
  if (!txt.includes("30–40")) throw new Error("нет правила 30–40 %");
  if (!txt.includes("переменный коэффициент")) throw new Error("нет пометки текущего режима");
  const full = JSON.stringify(N.catchHelp(p));
  if (!full.includes("контрольный пример")) throw new Error("в источниках нет ссылки на пример 2006");
});

test("catchCoeffHelp: показанный Q_r выбранного режима совпадает с catchParams", () => {
  for (const coeffMode of ["variable", "const"]) {
    const p = N.catchParams({ ...base(), coeffMode }, n);
    const txt = JSON.stringify(N.catchCoeffHelp(p));
    const expect = N.fmt(p.Qr, 1);
    if (!txt.includes(expect)) throw new Error(`режим ${coeffMode}: в справке нет Q_r = ${expect}`);
  }
});

test("catchCoeffHelp: доля водонепроницаемых поверхностей в режиме «по составу»", () => {
  const d = {
    ...base(), coeffSource: "table",
    zRows: [{ type: "imp", F: 2.45, z: 0.297 }, { type: "lawn", F: 1.45 }],
  };
  const p = N.catchParams(d, n);
  const txt = JSON.stringify(N.catchCoeffHelp(p));
  if (!txt.includes("62,8")) throw new Error("нет доли водонепроницаемых 62,8 %");
  if (!txt.includes("больше 30 %")) throw new Error("нет вывода «больше 30 %»");
  const manual = N.catchParams({ ...base(), coeffSource: "manual" }, n);
  const mtxt = JSON.stringify(N.catchCoeffHelp(manual));
  if (mtxt.includes("Доля водонепроницаемых")) throw new Error("в ручном режиме не должно быть доли");
});

test("coeffModeBlocks: расхождение Q_r двух режимов согласовано с формулами", () => {
  const p = N.catchParams({ ...base(), coeffMode: "variable" }, n);
  const blocks = N.coeffModeBlocks(p);
  const varQr = p.zMid * p.A ** 1.2 * p.F / p.tr ** (1.2 * p.n - 0.1);
  const constQr = p.psiMid * p.A * p.F / p.tr ** p.n;
  const txt = JSON.stringify(blocks);
  if (!txt.includes(N.fmt(varQr, 1))) throw new Error("нет переменного Q_r в справке о выборе");
  if (!txt.includes(N.fmt(constQr, 1))) throw new Error("нет постоянного Q_r в справке о выборе");
  approx(p.Qr, varQr, 1e-9);
});

test("catchCoeffHelp: таблицы Ж.6/Ж.7 строятся из справочников кода", () => {
  const p = N.catchParams({ ...base() }, n);
  const tables = N.catchCoeffHelp(p).filter(b => b.table);
  if (tables.length !== 2) throw new Error(`ожидалось 2 таблицы, получено ${tables.length}`);
  const t6 = tables[0].table;
  if (t6.rows.length !== N.SURFACE_TYPES.length)
    throw new Error("число строк Ж.6 не совпадает с SURFACE_TYPES");
  const impRow = t6.rows.find(r => r[0].includes("Водонепроницаемые"));
  if (!impRow || !impRow[1].includes("по Ж.7")) throw new Error("нет диапазона z для водонепроницаемых");
  if (!impRow[1].includes("0,23") || !impRow[1].includes("0,33"))
    throw new Error(`диапазон z не из Z_TABLE_N: ${impRow[1]}`);
  const lawnRow = t6.rows.find(r => r[0].includes("Газоны"));
  if (lawnRow[1] !== "0,038" || lawnRow[2] !== "0,10") throw new Error(`строка газонов неверна: ${lawnRow}`);
  const t7 = tables[1].table;
  if (t7.head.length !== N.Z_TABLE_A.length + 1) throw new Error("шапка Ж.7 не совпадает с Z_TABLE_A");
  if (t7.rows.length !== 2) throw new Error("в Ж.7 должно быть две строки по n");
  if (t7.rows[0][1] !== "0,32" || t7.rows[1][1] !== "0,33")
    throw new Error(`первые значения Ж.7 неверны: ${t7.rows[0][1]}/${t7.rows[1][1]}`);
});

test("catchSources: источники формул и таблиц (СП 32.13330, ВОДГЕО)", () => {
  const blocks = N.catchSources();
  if (!blocks.length || !blocks[0].h) throw new Error("нет заголовка блока источников");
  if (!Array.isArray(blocks[1].ol) || !blocks[1].ol.length) throw new Error("нет списка источников");
  const txt = blocks[1].ol.join(" ");
  if (!txt.includes("32.13330")) throw new Error("нет ссылки на СП 32.13330");
  if (!txt.includes("ВОДГЕО")) throw new Error("нет ссылки на ВОДГЕО");
  const full = JSON.stringify(N.catchHelp(N.catchParams({ ...base() }, n)));
  if (!full.includes("Источники")) throw new Error("в общей справке нет блока источников");
});

// ============================================================
// migrateNodeData
// ============================================================

const ioMocks = () => {
  const el = () => ({
    value: "0.71", hidden: false, textContent: "", innerHTML: "", style: {},
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: () => {}, append: () => {}, focus: () => {}, click: () => {},
  });
  global.$c = el;
  global.document = {
    getElementById: el, createElement: el,
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
  };
  global.window = { addEventListener: () => {}, innerWidth: 1024, innerHeight: 768, matchMedia: () => ({ matches: false }) };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
};
ioMocks();

const ioMod = new Function(
  `const NODE_PORTS = ${JSON.stringify(N.NODE_PORTS)};
const NODE_DEFAULTS = ${JSON.stringify(N.NODE_DEFAULTS)};
const NODE_HTML = ${JSON.stringify(N.NODE_HTML)};
function getGlobalN() { return 0.71; }
` + graphSrc + readSrc("cascade-io.js") + `
return { migrateNodeData };
`,
)();

test("migrateNodeData catch: legacy l1/v1… → segs, ключи удалены", () => {
  const d = ioMod.migrateNodeData("catch", { l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5, tcan: 5 });
  if (!Array.isArray(d.segs) || d.segs.length !== 3) throw new Error("segs не собраны из legacy");
  approx(d.segs[0].l, 68); approx(d.segs[0].v, 0.7);
  approx(d.segs[1].l, 133); approx(d.segs[1].v, 1.0);
  approx(d.segs[2].l, 277); approx(d.segs[2].v, 1.5);
  for (const k of ["l1", "v1", "l2", "v2", "l3", "v3"])
    if (k in d) throw new Error(`остался legacy-ключ ${k}`);
  approx(d.tcan, 5);
  if (!Array.isArray(d.trays) || d.trays.length) throw new Error("trays должен быть пустым массивом");
});

test("migrateNodeData catch: legacy даёт тот же tp, что и прежняя формула", () => {
  const d = ioMod.migrateNodeData("catch", { l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5 });
  const lv = 68 / 0.7 + 133 / 1.0 + 277 / 1.5;
  const p = N.catchParams(d, n);
  approx(p.tp, 0.017 * lv);
});

test("migrateNodeData catch: новый формат segs/trays нормализуется", () => {
  const d = ioMod.migrateNodeData("catch", { segs: [{ l: "10", v: "2" }], trays: [{ l: "3", v: "1" }] });
  approx(d.segs[0].l, 10); approx(d.segs[0].v, 2);
  approx(d.trays[0].l, 3); approx(d.trays[0].v, 1);
});

test("migrateNodeData catch: не-массивы segs/trays → пустые списки", () => {
  const d = ioMod.migrateNodeData("catch", { segs: "x", trays: null });
  if (!Array.isArray(d.segs) || d.segs.length) throw new Error("segs не приведён к []");
  if (!Array.isArray(d.trays) || d.trays.length) throw new Error("trays не приведён к []");
});

test("migrateNodeData catch: явный segs=[] не подменяется legacy", () => {
  const d = ioMod.migrateNodeData("catch", { segs: [], l1: 68, v1: 0.7 });
  if (d.segs.length !== 0) throw new Error("явный пустой segs перетёрт legacy");
});

test("migrateNodeData catch: coeffSource и zRows нормализуются", () => {
  const d = ioMod.migrateNodeData("catch", {
    coeffSource: "table",
    zRows: [
      { type: "imp", F: "2.45", z: "0.297" },
      { type: "lawn", F: 1.45 },
      { type: "bogus", F: 1 },
      { type: "", F: 1 },
      { type: "pav", F: "-3" },
    ],
  });
  if (d.coeffSource !== "table") throw new Error("coeffSource потерян");
  if (d.zRows.length !== 4) throw new Error(`zRows: ожидалось 4, получено ${d.zRows.length}`);
  approx(d.zRows[0].F, 2.45); approx(d.zRows[0].z, 0.297);
  if (d.zRows[1].z !== "") throw new Error("у газона z должен быть пустой строкой");
  approx(d.zRows[2].F, 1, 1e-9);           // bogus-тип не отбрасывается на уровне миграции
  if (d.zRows[3].F !== 0) throw new Error("отрицательная площадь → 0");
});

test("migrateNodeData catch: без coeffSource → manual, zRows — заготовки с F=0", () => {
  // Старая схема без zRows получает заготовки из NODE_DEFAULTS.
  const d = ioMod.migrateNodeData("catch", { F: 7.5 });
  if (d.coeffSource !== "manual") throw new Error("coeffSource не сброшен в manual");
  if (!Array.isArray(d.zRows) || d.zRows.length !== N.SURFACE_TYPES.length)
    throw new Error(`zRows: ожидались заготовки всех видов, получено ${d.zRows.length}`);
  if (d.zRows.some(r => r.F !== 0)) throw new Error("заготовки должны быть с нулевой площадью");
  // Мусор в zRows по-прежнему приводится к пустому списку.
  const bad = ioMod.migrateNodeData("catch", { zRows: "x" });
  if (!Array.isArray(bad.zRows) || bad.zRows.length) throw new Error("zRows не приведён к []");
  // Убранная добавочная площадь вычищается из старых схем.
  if ("Fadd" in ioMod.migrateNodeData("catch", { Fadd: 5 })) throw new Error("Fadd не удалён из данных");
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
if (failed > 0) process.exitCode = 1;
