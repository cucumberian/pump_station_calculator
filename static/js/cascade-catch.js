"use strict";

function delayDt(d) {
  const v = parseFloat(d.v), L = parseFloat(d.l ?? d.L);
  if (v > 0 && L >= 0) return L / v / 60;
  return Math.max(0, parseFloat(d.dt) || 0);
}

function num(x, fallback, min = -Infinity) {
  const v = parseFloat(x);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

// Участок сети/лотка: {l, v}. В сумму входят только участки с l > 0 и v > 0,
// мусорные записи отбрасываются (в данных ноды могут остаться как заготовки).
function parseSections(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    const L = parseFloat(s?.l), V = parseFloat(s?.v);
    if (Number.isFinite(L) && Number.isFinite(V) && L > 0 && V > 0) out.push({ l: L, v: V });
  }
  return out;
}

// Коэффициент покрова z водонепроницаемых поверхностей по таблице Ж.7
// СП 32.13330 (таблица 11 рекомендаций): зависит от параметров A и n.
// Сами табличные значения — в reference-data.js (Z_TABLE_A/Z_TABLE_N).
function impermeableZ(A, n) {
  const row = n < 0.65 ? Z_TABLE_N.low : Z_TABLE_N.high;
  const a = Math.min(Z_TABLE_A[Z_TABLE_A.length - 1], Math.max(Z_TABLE_A[0], A));
  let z = row[row.length - 1];
  for (let i = 0; i < Z_TABLE_A.length - 1; i++) {
    if (a <= Z_TABLE_A[i + 1]) {
      const x0 = Z_TABLE_A[i], x1 = Z_TABLE_A[i + 1];
      z = row[i] + (row[i + 1] - row[i]) * (a - x0) / (x1 - x0);
      break;
    }
  }
  return { z, outOfRange: A < Z_TABLE_A[0] || A > Z_TABLE_A[Z_TABLE_A.length - 1] };
}

// Состав поверхностей стока: [{type, F, z?}]. z — ручное переопределение
// (пусто = авто), имеет смысл только для водонепроницаемых; ψ — константа
// вида поверхности.
function parseSurfaces(raw, A, n) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const t = SURFACE_BY_KEY[r?.type];
    if (!t) continue;
    const area = num(r?.F, 0, 0);
    let z = t.z, zAuto = null, zManual = false;
    if (t.z == null) {
      const auto = impermeableZ(A, n);
      zAuto = auto.z;
      const ov = r?.z === "" || r?.z === null || r?.z === undefined ? NaN : parseFloat(r.z);
      zManual = Number.isFinite(ov);
      z = zManual ? ov : auto.z;
    }
    out.push({ type: t.key, label: t.label, F: area, z, psi: t.psi, zAuto, zManual });
  }
  return out;
}

function catchParams(d, n) {
  const q20 = num(d.q20, 80, 0.01);
  // Страховка от нижнерегистровых дубликатов f/p, которые Drawflow мог оставить
  // в старых схемах (см. migrateNodeData): canonical приоритетен, дубль — fallback.
  const P = num(d.P !== undefined ? d.P : d.p, 1, 0.01);
  const mr = num(d.mr, 150, 1.01);
  const gamma = num(d.gamma, 1.54, 0.01);
  const A = q20 * 20 ** n * (1 + Math.log(P) / Math.log(mr)) ** gamma;
  // Коэффициенты покрова/стока: вручную (zMid/psiMid) или средневзвешенно
  // по составу поверхностей zRows (F = ΣFᵢ) — см. п. 6.2.6 рекомендаций.
  const coeffSource = d.coeffSource === "table" ? "table" : "manual";
  const surfaces = coeffSource === "table" ? parseSurfaces(d.zRows, A, n) : [];
  const areaSum = surfaces.reduce((s, x) => s + x.F, 0);
  const useTable = coeffSource === "table" && areaSum > 0;
  const zTable = useTable ? surfaces.reduce((s, x) => s + x.F * x.z, 0) / areaSum : null;
  const psiTable = useTable ? surfaces.reduce((s, x) => s + x.F * x.psi, 0) / areaSum : null;
  const zImpAuto = coeffSource === "table" ? impermeableZ(A, n) : null;
  const zMid = useTable ? zTable : num(d.zMid, 0.201, 0.001);
  const psiMid = useTable ? psiTable : num(d.psiMid, 0.634, 0.001);
  const manualF = num(d.F !== undefined ? d.F : d.f, 3.9, 0.001);
  const F = useTable ? areaSum : manualF;
  const areaOver = useTable && areaSum > 150;
  const tcon = num(d.tcon, 3, 0);
  const segs = parseSections(d.segs);
  const trays = parseSections(d.trays);
  // tp — протекание по трубам коллектора, формула (17): 0,017·Σ(l/v)
  // (в СНиП 2.04.03-85 — формула (7)), плюс ручная добавка.
  const lvSum = segs.reduce((s, x) => s + x.l / x.v, 0);
  const tpManual = num(d.tp, 0, 0);
  const tpCalc = 0.017 * lvSum;
  const tp = tpManual + tpCalc;
  // t_can — протекание по уличным лоткам, формула (16): 0,021·Σ(l/v)
  // (в СНиП 2.04.03-85 — формула (6)), плюс ручная добавка (если инженер
  // задал время напрямую).
  const lvTraySum = trays.reduce((s, x) => s + x.l / x.v, 0);
  const tcanManual = num(d.tcan, 0, 0);
  const tcanCalc = 0.021 * lvTraySum;
  const tcan = tcanManual + tcanCalc;
  const tr = tcon + tcan + tp;
  const variable = d.coeffMode !== "const";
  const Qr = tr > 0
    ? (variable ? zMid * A ** 1.2 * F / tr ** (1.2 * n - 0.1) : psiMid * A * F / tr ** n)
    : 0;
  return { q20, P, mr, gamma, F, manualF, psiMid, zMid, tcon, segs, trays, A, lvSum, lvTraySum,
    tp, tpManual, tpCalc, tcan, tcanManual, tcanCalc, tr, Qr, variable, n,
    coeffSource, surfaces, areaSum, useTable, areaOver, zImpAuto };
}

// Справка по t_r: сумма времени поверхностной концентрации, протекания по
// лоткам (ф. 16) и по трубам (ф. 17) — с подставленными значениями ноды.
// Открывается отдельной кнопкой «?» у заголовка «Расчётная продолжительность
// дождя», поэтому в ней нет A и Qr.
function catchTrHelp(p) {
  const texSum = sections => sections.length
    ? sections.map(s => `\\frac{${fmt(s.l, 0)}}{${fmt(s.v, 2)}}`).join(" + ")
    : "0";
  const segTex = texSum(p.segs);
  const trayTex = texSum(p.trays);
  const manual = p.tcanManual > 0 ? ` + ${fmt(p.tcanManual, 1)}` : "";
  const manualP = p.tpManual > 0 ? ` + ${fmt(p.tpManual, 1)}` : "";
  return [
    { p: "Расчётная продолжительность дождя — сумма времени поверхностной концентрации, протекания по уличным лоткам и по трубам до рассматриваемого сечения (формула (15) п. 5.3.5):" },
    { tex: `t_r = t_{con} + t_{can} + t_p = ${fmt(p.tcon, 0)} + ${fmt(p.tcan, 1)} + ${fmt(p.tp, 1)} = ${fmt(p.tr, 1)}\\ \\text{мин}` },
    { ol: [
      "t_con — продолжительность протекания дождевых вод до уличного лотка (время поверхностной концентрации), мин — задаётся вручную;",
      "t_can — продолжительность протекания по уличным лоткам до дождеприёмника, мин (см. ниже);",
      "t_p — продолжительность протекания по трубам до рассматриваемого сечения, мин (см. ниже).",
    ] },
    { p: "Время протекания по лоткам (формула (16); в СНиП 2.04.03-85 — формула (6)) — 0,021 на каждый участок лотка длиной l_can со скоростью v_can; при задании времени вручную оно прибавляется:" },
    { tex: `t_{can} = 0{,}021\\sum \\frac{l_{can}}{v_{can}}${manual} = 0{,}021\\left(${trayTex}\\right)${manual} = ${fmt(p.tcan, 1)}\\ \\text{мин}` },
    { ol: [
      "l_can — длина участков лотков, м;",
      "v_can — расчётная скорость течения на участке, м/с.",
    ] },
    { p: "Время протекания по трубам (формула (17); в СНиП 2.04.03-85 — формула (7)) — 0,017 на каждый участок дождевой сети; при задании времени вручную оно прибавляется:" },
    { tex: `t_p = 0{,}017\\sum \\frac{l_p}{v_p}${manualP} = 0{,}017\\left(${segTex}\\right)${manualP} = ${fmt(p.tp, 1)}\\ \\text{мин}` },
    { ol: [
      "lₚ — длина расчётных участков дождевой сети, м;",
      "vₚ — расчётная скорость течения на участках, м/с (принимается по гидравлическому расчёту сети).",
    ] },
  ];
}

// Таблицы коэффициентов для справки строятся из тех же массивов, что и расчёт
// (SURFACE_TYPES, Z_TABLE_A/Z_TABLE_N), чтобы модалка не расходилась с
// источником истины.
function coeffTableBlocks() {
  const allZ = [...Z_TABLE_N.low, ...Z_TABLE_N.high];
  const zMin = Math.min(...allZ), zMax = Math.max(...allZ);
  return [
    { p: "Таблица Ж.6 — значения коэффициентов покрова z и постоянного коэффициента стока ψ для различных видов поверхности стока:" },
    { table: {
      head: ["Вид поверхности стока", "z — коэффициент покрова", "ψ — коэффициент стока"],
      rows: SURFACE_TYPES.map(t => [
        t.label,
        t.z == null ? `${fmt(zMin)}–${fmt(zMax)} (по Ж.7)` : fmt(t.z, 3),
        fmt(t.psi, 2),
      ]),
    } },
    { p: "Таблица Ж.7 — значения коэффициента z для водонепроницаемых поверхностей (кровли, асфальтобетон) в зависимости от параметра A и показателя n:" },
    { table: {
      head: ["Параметр n", ...Z_TABLE_A.map(String)],
      rows: [
        ["менее 0,65", ...Z_TABLE_N.low.map(v => fmt(v, 2))],
        ["0,65 и более", ...Z_TABLE_N.high.map(v => fmt(v, 2))],
      ],
    } },
  ];
}

// Справка о выборе коэффициента стока: переменный z (формула (20) примера
// ВОДГЕО 2006; формула (4) рекомендаций 2015) или постоянный Ψ (формула (12);
// формула (5) соответственно). Оба расхода считаются по текущим параметрам
// ноды, чтобы наглядно показать расхождение и правило 30–40 %.
function coeffModeBlocks(p) {
  const variableQr = p.tr > 0 ? p.zMid * p.A ** 1.2 * p.F / p.tr ** (1.2 * p.n - 0.1) : 0;
  const constQr = p.tr > 0 ? p.psiMid * p.A * p.F / p.tr ** p.n : 0;
  const diff = Math.max(variableQr, constQr) > 0
    ? Math.abs(variableQr - constQr) / Math.max(variableQr, constQr) * 100
    : 0;
  const blocks = [
    { h: "Выбор коэффициента стока: переменный z или постоянный Ψ" },
    { p: "Переменный коэффициент стока (коэффициент покрова z) зависит от вида поверхности водосбора, а также от интенсивности и продолжительности дождя (А.25 рекомендаций ВОДГЕО (2015)). Постоянный коэффициент стока Ψ зависит только от вида поверхности (А.26). Оба средневзвешенных значения z_mid и Ψ_mid считаются по составу поверхностей (см. выше)." },
    { p: "Переменный коэффициент — формула (20) примера ВОДГЕО (2006); в рекомендациях ВОДГЕО (2015) — формула (4):" },
    { tex: `Q_r = \\frac{z_{mid}\\, A^{1{,}2}\\, F}{t_r^{\\,1{,}2n\\,-\\,0{,}1}} = \\frac{${fmt(p.zMid, 3)}\\cdot ${fmt(p.A)}^{1{,}2}\\cdot ${fmt(p.F, 2)}}{${fmt(p.tr, 1)}^{\\,${fmt(1.2 * p.n - 0.1, 3)}}} = ${fmt(variableQr, 1)}\\ \\text{л/с}` },
    { p: "Постоянный коэффициент — формула (12) примера ВОДГЕО (2006); в рекомендациях ВОДГЕО (2015) — формула (5):" },
    { tex: `Q_r = \\frac{\\Psi_{mid}\\, A\\, F}{t_r^{\\,n}} = \\frac{${fmt(p.psiMid, 3)}\\cdot ${fmt(p.A)}\\cdot ${fmt(p.F, 2)}}{${fmt(p.tr, 1)}^{${fmt(p.n)}}} = ${fmt(constQr, 1)}\\ \\text{л/с}` },
    { p: `В расчёте ноды сейчас используется ${p.variable ? "переменный коэффициент — формула (20)" : "постоянный коэффициент — формула (12)"}, то есть Q_r = ${fmt(p.Qr, 1)} л/с. Расхождение двух вариантов на текущих значениях — ${fmt(diff, 1)} %.` },
    { p: "Если водонепроницаемые поверхности составляют более 30–40 % общей площади стока (характерно для промышленных площадок и центральной части городской застройки), допускается упрощённо пользоваться формулой (12) при постоянных коэффициентах стока — расхождение с переменным коэффициентом при этом обычно невелико (в контрольном примере ВОДГЕО (2006) — около 5,5 %) (примечание к п. 6.2.1 рекомендаций ВОДГЕО (2015); п. 2.3.1 примера ВОДГЕО (2006))." },
  ];
  if (p.useTable) {
    const impArea = p.surfaces.reduce((s, r) => s + (r.type === "imp" ? r.F : 0), 0);
    const share = p.areaSum > 0 ? impArea / p.areaSum * 100 : 0;
    blocks.push({ p: `Доля водонепроницаемых поверхностей по заданному составу: ${fmt(impArea, 2)} из ${fmt(p.areaSum, 2)} га = ${fmt(share, 1)} % — ${share > 30 ? "больше 30 %" : "меньше 30 %"}, ${share > 30 ? "упрощение по формуле (12) допустимо" : "упрощение по формуле (12) требует обоснования"}.` });
  }
  return blocks;
}

// Справка по коэффициентам z_mid/ψ_mid: общая формула средневзвешенного
// значения и — в режиме «по составу поверхностей» — подстановка по строкам.
function catchCoeffHelp(p) {
  const rows = p.surfaces || [];
  const table = p.coeffSource === "table";
  const head = { p: "Коэффициент покрова z и постоянный коэффициент стока ψ для бассейна стока определяются как средневзвешенные по видам поверхности (п. 6.2.6; таблица Ж.6, для водонепроницаемых z — по таблице Ж.7):" };
  if (!table || !rows.length) {
    return [
      head,
      { tex: "z_{mid} = \\frac{\\sum F_i z_i}{\\sum F_i}, \\qquad \\Psi_{mid} = \\frac{\\sum F_i \\Psi_i}{\\sum F_i}" },
      { ol: [
        "F_i — площадь поверхности i-го вида, га;",
        "z_i — коэффициент покрова по таблице Ж.6 (для водонепроницаемых — по таблице Ж.7 в зависимости от A и n);",
        "ψ_i — постоянный коэффициент стока по таблице Ж.6.",
      ] },
      table
        ? { p: "Включён режим «по составу поверхностей», но строки не заданы: в расчёте используются ручные z_mid и ψ_mid." }
        : { p: `Режим «вручную»: приняты z_mid = ${fmt(p.zMid, 3)} и ψ_mid = ${fmt(p.psiMid, 3)}. Чтобы получить их по таблице Ж.6, переключите источник площади и коэффициентов на «по составу поверхностей» и задайте площади.` },
      ...coeffModeBlocks(p),
      ...coeffTableBlocks(),
    ];
  }
  const zTerms = rows.filter(r => r.F > 0).map(r => `${fmt(r.z, 3)}\\cdot${fmt(r.F, 2)}`).join(" + ") || "0";
  const psiTerms = rows.filter(r => r.F > 0).map(r => `${fmt(r.psi, 2)}\\cdot${fmt(r.F, 2)}`).join(" + ") || "0";
  const list = rows.map(r => {
    const src = r.type !== "imp" ? "" : r.zManual ? " (z задан вручную)" : " (z авто по Ж.7)";
    return `${r.label}: F = ${fmt(r.F, 2)} га, z = ${fmt(r.z, 3)}${src}, ψ = ${fmt(r.psi, 2)}`;
  });
  const imp = rows.find(r => r.type === "imp");
  return [
    head,
    { p: "Площадь стока F = ΣFᵢ, а средневзвешенные коэффициенты — по составу поверхностей:" },
    { tex: `F = \\sum F_i = ${fmt(p.areaSum, 2)}\\ \\text{га}` },
    { tex: `z_{mid} = \\frac{\\sum F_i z_i}{\\sum F_i} = \\frac{${zTerms}}{${fmt(p.areaSum, 2)}} = ${fmt(p.zMid, 3)}` },
    { tex: `\\Psi_{mid} = \\frac{\\sum F_i \\Psi_i}{\\sum F_i} = \\frac{${psiTerms}}{${fmt(p.areaSum, 2)}} = ${fmt(p.psiMid, 3)}` },
    { ol: list },
    ...(imp ? [{ p: `Для водонепроницаемых поверхностей z берётся из таблицы Ж.7 по A и n: при A = ${fmt(p.A, 0)} и n = ${fmt(p.n, 2)} получается z = ${fmt(imp.zAuto ?? imp.z, 3)}${imp.zManual ? ` (в расчёте вручную задано ${fmt(imp.z, 3)})` : ""}.` }] : []),
    ...(p.areaOver ? [{ p: "Внимание: расчётная площадь стока превышает 150 га — ограничение нормы (п. Ж.1)." }] : []),
    ...coeffModeBlocks(p),
    ...coeffTableBlocks(),
  ];
}

// Источники формул и таблиц — единый список для пометки в справке.
const CATCH_SOURCES = [
  "СП 32.13330.2018 «Канализация. Наружные сети и сооружения» (актуализированная редакция СНиП 2.04.03-85): Приложение Ж — формулы параметра A, таблицы Ж.6 (коэффициенты покрова) и Ж.7 (z водонепроницаемых).",
  "«Рекомендации по расчёту систем сбора, отведения и очистки поверхностного стока селитебных территорий, площадок предприятий и определению условий выпуска его в водные объекты» (Методическое пособие, НИИ ВОДГЕО, 2015): п. 6.2.1 — формулы Qr при переменном (4) и постоянном (5) коэффициентах стока и примечание о 30 % водонепроницаемых поверхностей; А.25–А.26 — определения переменного и постоянного коэффициентов стока; п. 6.2.6 — формулы Qr, tr, tcan, tp и таблицы 10–11.",
  "«Пример расчёта количественных характеристик поверхностного стока…», ФГУП НИИ ВОДГЕО, Москва, 2006, п. 2.3.1 — формулы (12) (постоянный) и (20) (переменный коэффициент), правило 30–40 % и контрольный пример (z_mid = 0,201; ψ_mid = 0,634; Qr = 342,3 / 323,5 л/с).",
];
function catchSources() {
  return [
    { h: "Источники данных и формул" },
    { ol: CATCH_SOURCES },
  ];
}

function catchHelp(p) {
  return [
    { p: "Расходы дождевых вод определяются по методу предельных интенсивностей (раздел 5.3 рекомендаций; пример расчёта — п. 2.3.1 пособия)." },
    { p: "Параметр A, характеризующий интенсивность и продолжительность дождя для конкретной местности (п. 5.3.2):" },
    { tex: `A = q_{20}\\, 20^{\\,n}\\left(1+\\frac{\\lg P}{\\lg m_r}\\right)^{\\!\\gamma} = ${fmt(p.q20)}\\cdot 20^{${fmt(p.n)}}\\left(1+\\frac{\\lg ${fmt(p.P, 1)}}{\\lg ${fmt(p.mr, 0)}}\\right)^{${fmt(p.gamma)}} = ${fmt(p.A)}` },
    { ol: [
      "q₂₀ — интенсивность дождя для данной местности продолжительностью 20 мин при P = 1 год, л/с с 1 га (Приложение 2 рекомендаций или рис. 1 СНиП 2.04.03-85);",
      "n — показатель степени, климатический параметр местности (общий параметр схемы; таблица Приложения 3);",
      "mr — среднее количество дождей за год (таблица Приложения 3);",
      "P — период однократного превышения расчётной интенсивности дождя, годы (таблица 8 п. 5.3.3);",
      "γ — показатель степени (таблица Приложения 3).",
    ] },
    ...catchTrHelp(p),
    ...catchCoeffHelp(p),
    ...(p.variable ? [
      { p: "Расчётный расход при переменном коэффициенте стока — формула (20):" },
      { tex: `Q_r = \\frac{z_{mid}\\, A^{1{,}2}\\, F}{t_r^{\\,1{,}2n\\,-\\,0{,}1}} = \\frac{${fmt(p.zMid, 3)}\\cdot ${fmt(p.A)}^{1{,}2}\\cdot ${fmt(p.F, 2)}}{${fmt(p.tr, 1)}^{\\,${fmt(1.2 * p.n - 0.1, 3)}}} = ${fmt(p.Qr, 1)}\\ \\text{л/с}` },
      { ol: [
        p.coeffSource === "table"
          ? "z_mid — средневзвешенный коэффициент покрова по составу поверхностей (таблицы Ж.6 и Ж.7);"
          : "z_mid — среднее значение коэффициента, характеризующего вид поверхности бассейна водосбора (коэффициент покрова); средневзвешенная величина по таблицам 11–12 рекомендаций или СНиП 2.04.03-85;",
        "A — параметр интенсивности дождя (см. выше);",
        "F — расчётная площадь стока (водосбора), га;",
        "t_r — расчётная продолжительность дождя, мин.",
      ] },
    ] : [
      { p: "Расчётный расход при постоянном коэффициенте стока — формула (12):" },
      { tex: `Q_r = \\frac{\\Psi_{mid}\\, A\\, F}{t_r^{\\,n}} = \\frac{${fmt(p.psiMid, 3)}\\cdot ${fmt(p.A)}\\cdot ${fmt(p.F, 2)}}{${fmt(p.tr, 1)}^{${fmt(p.n)}}} = ${fmt(p.Qr, 1)}\\ \\text{л/с}` },
      { ol: [
        p.coeffSource === "table"
          ? "Ψ_mid — средневзвешенный постоянный коэффициент стока по составу поверхностей (таблица Ж.6);"
          : "Ψ_mid — средний постоянный коэффициент стока; средневзвешенная величина по таблице 11 рекомендаций или СНиП 2.04.03-85;",
        "A — параметр интенсивности дождя (см. выше);",
        "F — расчётная площадь стока (водосбора), га;",
        "t_r — расчётная продолжительность дождя, мин.",
      ] },
    ]),
    { p: "При подключении к ноде насосной станции её параметры Qr и tr блокируются и принимаются равными рассчитанным здесь значениям." },
    ...catchSources(),
  ];
}
