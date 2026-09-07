"use strict";

const $view = id => document.getElementById(id);

// Малые значения не обнуляем: добавляем знаки до первых значащих цифр.
// fmt(0.0441, 1) → «0,044», fmt(4.41, 1) → «4,4» — как раньше для крупных.
function fmtDecimals(x, d) {
  const v = Number(x);
  if (v !== 0 && Number.isFinite(v) && Math.abs(v) < 1) {
    return Math.min(8, Math.max(d, 1 - Math.floor(Math.log10(Math.abs(v)))));
  }
  return d;
}
const fmt = (x, d = 2) =>
  Number(x).toLocaleString("ru-RU", { maximumFractionDigits: fmtDecimals(x, d) });

// Формат с N значащими цифрами — для величин, подставляемых в формулы,
// чтобы строка вычислений сходилась с итогом даже при вычитании близких чисел.
function fmtSig(x, sig = 4) {
  const v = Number(x);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const dec = Math.min(10, Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v)))));
  return v.toLocaleString("ru-RU", { maximumFractionDigits: dec });
}

// Округление для данных графиков/таблиц: малые значения сохраняют 2 знака.
const smartRound = v => {
  const a = Math.abs(v);
  if (!Number.isFinite(v)) return 0;
  return a > 0 && a < 0.01 ? +v.toPrecision(2) : +v.toFixed(2);
};

// Почти нулевой объём — не ошибка, а особенный режим: резервуар почти не работает.
function nearZeroNote(r) {
  if (!r || r.dry || !(r.W > 0)) return null;
  if (r.W >= 0.05) return null;
  const fill = Number.isFinite(r.tk) && Number.isFinite(r.tn) && r.tk > r.tn
    ? ` Наполнение резервуара длится всего ${fmt(r.tk - r.tn)} мин в пике дождя.`
    : "";
  return `Qⁿˢ почти равен притоку: объём регулирования стремится к нулю.${fill}`;
}

function tex(formula) {
  const span = document.createElement("span");
  katex.render(formula, span, { throwOnError: false });
  return span;
}

function traceTk(Q, Qr, tr, n) {
  const f = T => Qr * ((T / tr) ** (1 - n) - (T / tr - 1) ** (1 - n));
  const bracket = [];
  let lo = tr, hi = tr * 2;
  while (f(hi) > Q) { bracket.push([lo, hi]); lo = hi; hi *= 2; }
  bracket.push([lo, hi]);
  const iters = [];
  for (let i = 1; hi - lo > 0.005 && i <= 100; i++) {
    const mid = (lo + hi) / 2;
    iters.push([i, lo, hi, mid, f(mid)]);
    if (f(mid) > Q) lo = mid; else hi = mid;
  }
  return { bracket, iters, tk: (lo + hi) / 2 };
}

function openHelp(blocks, ctx) {
  const body = $view("modalBody");
  body.innerHTML = "";
  for (const b of blocks) {
    if (b.p) {
      const p = document.createElement("p");
      p.textContent = b.p;
      body.append(p);
    } else if (b.tex) {
      const d = document.createElement("div");
      d.className = "modal-tex";
      katex.render(b.tex, d, { displayMode: true, throwOnError: false });
      body.append(d);
    } else if (b.ol) {
      const ol = document.createElement("ol");
      for (const item of b.ol) {
        const li = document.createElement("li");
        li.textContent = item;
        ol.append(li);
      }
      body.append(ol);
    } else if (b.trace) {
      const t = traceTk(ctx.Q, ctx.Qr, ctx.tr, ctx.n);
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = `Итерации подбора для текущих значений (Qнс = ${fmt(ctx.Q)} л/с)`;
      det.append(sum);
      const tbl = document.createElement("table");
      tbl.className = "trace";
      tbl.innerHTML = "<thead><tr><th>#</th><th>отрезок [lo; hi], мин</th><th>T = середина, мин</th><th>f(T), л/с</th></tr></thead>";
      const tb = tbl.createTBody();
      for (const [j, [lo, hi]] of t.bracket.entries()) {
        const row = tb.insertRow();
        row.className = "bracket";
        [`г${j}`, `[${fmt(lo, 2)}; ${fmt(hi, 2)}]`, "—", "—"].forEach(x => row.insertCell().textContent = x);
      }
      for (const [i, lo, hi, mid, fm] of t.iters) {
        const row = tb.insertRow();
        [i, `[${fmt(lo, 4)}; ${fmt(hi, 4)}]`, fmt(mid, 4), fmt(fm, 2)].forEach(x => row.insertCell().textContent = x);
      }
      const res = document.createElement("p");
      res.className = "trace-res";
      res.textContent = `Итог: Tкⁿˢ = ${fmt(t.tk, 2)} мин (f = ${fmt(t.iters.at(-1)?.[4] ?? ctx.Q, 2)} л/с ≈ Qнс)`;
      det.append(tbl, res);
      body.append(det);
    }
  }
  $view("modal").hidden = false;
}

function bindModal() {
  $view("modalClose").addEventListener("click", () => { $view("modal").hidden = true; });
  $view("modal").addEventListener("click", e => { if (e.target === $view("modal")) $view("modal").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $view("modal").hidden = true; });
}

const CARDS = [
  {
    title: "Tнⁿˢ — начало превышения, мин",
    sym: "T_{н}^{\\text{нс}}", unit: "\\text{мин}",
    val: r => fmt(r.tn),
    tex: (Q, Qr, tr, n, r) =>
      `T_{н}^{\\text{нс}} = t_r\\left(\\frac{Q_{нс}}{Q_r}\\right)^{\\frac{1}{1-n}} = ${fmt(tr)}\\left(\\frac{${fmt(Q)}}{${fmt(Qr)}}\\right)^{\\frac{1}{1-${fmt(n)}}} = ${fmt(r.tn)}\\ \\text{мин}`
  },
  {
    title: "Tкⁿˢ — конец превышения, мин",
    sym: "T_{к}^{\\text{нс}}", unit: "\\text{мин}",
    val: r => fmt(r.tk),
    tex: (Q, Qr, tr, n, r) =>
      `Q_{нс} = Q_r\\left[\\left(\\frac{T_{к}^{\\text{нс}}}{t_r}\\right)^{1-n} - \\left(\\frac{T_{к}^{\\text{нс}}}{t_r}-1\\right)^{1-n}\\right] \\Rightarrow T_{к}^{\\text{нс}} = ${fmt(r.tk)}\\ \\text{мин}`,
    help: [
      { p: "Tкⁿˢ не выражается прямой формулой — она находится подбором (итерационно), формула (3) Приложения 8. Решается уравнение относительно T > tr:" },
      { tex: "Q_{нс} = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right]" },
      { p: "Правая часть при T > tr монотонно убывает от Qr (при T = tr) до 0, поэтому корень единственный." },
      { p: "Численно уравнение решается методом бисекции (деления отрезка пополам):" },
      { ol: [
        "Начальный отрезок [tr; 2·tr]; верхняя граница удваивается, пока f(T) > Qнс — так корень гарантированно оказывается внутри отрезка.",
        "Итерации делят отрезок пополам: если f(середина) > Qнс — корень в правой половине, иначе в левой.",
      ] },
      { trace: true },
      { p: "Пример из методички: Qнс = 100 л/с, Qr = 342,3 л/с, tr = 10 мин, n = 0,71 → подбор даёт Tкⁿˢ = 15,61 мин." },
    ],
  },
  {
    title: "Wнс — рабочий объём резервуара, м³",
    sym: "W_{нс}", unit: "\\text{м}^3",
    wide: true,
    znote: true,
    val: r => fmt(r.W, 1),
    tex: (Q, Qr, tr, n, r) => {
      // В подстановку идут значения с 5 значащими цифрами: слагаемые вычитаются
      // из близких чисел, при 2–3 знаках строка «не сходится» с итогом.
      const k = v => fmtSig(v, 5);
      return `\\begin{aligned} W_{нс} &= \\frac{0{,}06\\,Q_r\\,t_r}{2-n}\\left[\\left(\\frac{T_{к}^{\\text{нс}}}{t_r}\\right)^{2-n} - \\left(\\frac{T_{н}^{\\text{нс}}}{t_r}\\right)^{2-n} - \\left(\\frac{T_{к}^{\\text{нс}}}{t_r}-1\\right)^{2-n} - \\frac{Q_{нс}}{Q_r}(2-n)\\left(\\frac{T_{к}^{\\text{нс}}}{t_r}-\\frac{T_{н}^{\\text{нс}}}{t_r}\\right)\\right] \\\\ &= \\frac{0{,}06\\cdot ${k(Qr)}\\cdot ${k(tr)}}{2-${k(n)}}\\left[ ${k(r.tk / tr)}^{${k(2 - n)}} - ${k(r.tn / tr)}^{${k(2 - n)}} - ${k(r.tk / tr - 1)}^{${k(2 - n)}} - ${k(Q / Qr)}\\cdot ${k(2 - n)}\\cdot (${k(r.tk / tr)}-${k(r.tn / tr)}) \\right] = ${fmt(r.W, 1)}\\ \\text{м}^3 \\end{aligned}`;
    }
  },
];

const HYDRO_HELP = [
  { p: "Гидрограф Q(T) — расход дождевого стока, поступающего в насосную станцию в момент времени T от начала дождя. Строится по формулам (2) и (3) Приложения 8 рекомендаций ВОДГЕО." },
  { p: "Ветвь подъёма (T ≤ tr). По методу предельных интенсивностей интенсивность дождя убывает с его продолжительностью как t^(−n), а накопленный к моменту T объём стока пропорционален T^(1−n). Поэтому расход нарастает по степенному закону от 0 до Qr:" },
  { tex: "Q(T) = Q_r\\left(\\frac{T}{t_r}\\right)^{1-n}, \\quad T \\le t_r" },
  { p: "Это же соотношение в виде формулы (2) Приложения 8, решённой относительно времени (момент начала превышения, точка на ветви подъёма):" },
  { tex: "T_{н}^{\\text{нс}} = t_r\\left(\\frac{Q_{\\text{нс}}}{Q_r}\\right)^{\\frac{1}{1-n}}" },
  { p: "Ветвь спада (T > tr). Дождь конечной продолжительности tr представляется как разность двух бесконечных дождей, начавшихся в моменты 0 и tr (принцип суперпозиции). Поэтому из ветви подъёма вычитается такая же ветвь, сдвинутая на tr:" },
  { tex: "Q(T) = Q_r\\left[\\left(\\frac{T}{t_r}\\right)^{1-n} - \\left(\\frac{T}{t_r}-1\\right)^{1-n}\\right], \\quad T > t_r" },
  { p: "Это в точности правая часть формулы (3) Приложения 8, из которой подбором находится Tкⁿˢ (метод бисекции). График строится непосредственно по этим двум формулам." },
  { p: "Пик гидрографа — точка T = tr, Q = Qr: при T = tr ветвь подъёма даёт Qr, а вычитаемый член ветви спада равен нулю. Закрашенная площадь между кривой и линией Qнс на интервале [Tнⁿˢ; Tкⁿˢ] — рабочий объём Wнс (формула (1) Приложения 8)." },
];

function buildCards(cardsEl, Q, Qr, tr, n, r, numeric, noteText = null) {
  cardsEl.innerHTML = "";
  const znote = (!numeric && r) ? nearZeroNote(r) : null;
  for (const c of CARDS) {
    const div = document.createElement("div");
    div.className = "card" + (c.wide ? " wide" : "");
    const h = document.createElement("h3");
    h.textContent = c.title;
    if (c.help && !numeric) {
      const btn = document.createElement("button");
      btn.className = "help-btn";
      btn.type = "button";
      btn.textContent = "?";
      btn.title = "Как считается этот параметр";
      btn.addEventListener("click", () => openHelp(c.help, { Q, Qr, tr, n }));
      div.append(btn);
    }
    const v = document.createElement("div");
    v.className = "value";
    v.append(tex(`${c.sym} = ${c.val(r, Q)}\\ ${c.unit}`));
    if (numeric) {
      const note = document.createElement("span");
      note.className = "num-note";
      note.textContent = noteText || "численно по суммарному гидрографу";
      div.append(h, note, v);
    } else {
      div.append(h, tex(c.tex(Q, Qr, tr, n, r)), v);
      if (noteText) {
        const note = document.createElement("span");
        note.className = "num-note";
        note.textContent = noteText;
        div.append(note);
      }
      if (c.znote && znote) {
        const note = document.createElement("span");
        note.className = "num-note";
        note.style.color = "#b45309";
        note.textContent = znote;
        div.append(note);
      }
    }
    cardsEl.append(div);
  }
}

const EC_REGISTRY = [];
const sharedZoom = { start: 0, end: 100 };
function makeEChart(el, { slider = false, title = "", legend = false, toolbox = true } = {}) {
  const inst = echarts.init(el, null, { renderer: "canvas" });
  EC_REGISTRY.push(inst);
  const legendH = legend ? 18 : 0;
  const base = {
    animation: false,
    grid: {
      left: 64, right: 16,
      top: title ? 32 : 12,
      bottom: (slider ? 58 : 36) + legendH, containLabel: false,
    },
    title: title ? { text: title, left: 4, top: 2, right: 0, textStyle: { fontSize: 13, fontWeight: 600, color: "#12325e", overflow: "truncate", width: 300 } } : undefined,
    legend: legend ? { left: "center", bottom: slider ? 24 : 8, itemWidth: 14, itemHeight: 8, itemGap: 12, textStyle: { fontSize: 11 }, icon: "rect" } : undefined,
    ...(toolbox ? { toolbox: {
      right: 4, top: 0, itemSize: 14,
      feature: {
        dataZoom: { yAxisIndex: "none", title: { zoom: "Зум рамкой" } },
        saveAsImage: { title: "Сохранить PNG", name: "kns-chart", pixelRatio: 2 },
      },
    } } : {}),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", label: { backgroundColor: "#12325e", formatter: p => Number.isFinite(+p.value) ? fmt(+p.value, 1) : p.value } },
      confine: true,
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false },
      ...(slider ? [{ type: "slider", xAxisIndex: 0, height: 20, bottom: 6, brushSelect: false }] : []),
    ],
  };
  let firstRender = true;
  let _applyingZoom = false;
  inst.on("datazoom", () => {
    if (_applyingZoom) return;
    try {
      const opts = inst.getOption();
      if (opts?.dataZoom?.length) {
        sharedZoom.start = opts.dataZoom[0].start ?? 0;
        sharedZoom.end = opts.dataZoom[0].end ?? 100;
      }
    } catch (_) {}
  });
  return {
    inst,
    update(option) {
      const merged = { ...base, ...option };
      for (const k of ["title", "legend", "tooltip", "toolbox"]) {
        if (base[k] && option[k]) merged[k] = { ...base[k], ...option[k] };
        else if (!base[k] && k === "toolbox") delete merged[k];
      }
      if (firstRender) {
        firstRender = false;
        merged.dataZoom = merged.dataZoom.map(dz => ({
          ...dz,
          start: sharedZoom.start,
          end: sharedZoom.end,
        }));
      } else {
        try {
          const prev = inst.getOption();
          if (prev && Array.isArray(prev.dataZoom) && prev.dataZoom.length) {
            merged.dataZoom = merged.dataZoom.map((dz, i) => ({
              ...dz,
              start: prev.dataZoom[i]?.start ?? dz.start,
              end: prev.dataZoom[i]?.end ?? dz.end,
            }));
          }
        } catch (_) {}
      }
      _applyingZoom = true;
      inst.setOption(merged, { notMerge: true, lazyUpdate: true });
      _applyingZoom = false;
    },
  };
}
window.addEventListener("resize", () => { for (const c of EC_REGISTRY) c.resize(); });

function ecAxisTip(unit) {
  return params => {
    const pts = params.filter(p => p.value && Number.isFinite(p.value[1]));
    if (!pts.length) return "";
    const lines = [`T = ${fmt(pts[0].value[0], 1)} мин`];
    for (const p of pts) lines.push(`${p.marker}${p.seriesName}: <b>${fmt(p.value[1], 1)}</b> ${unit}`);
    return lines.join("<br>");
  };
}

function makeWQChart(el) {
  const ec = makeEChart(el, { legend: true, title: "Wнс от Qнс", toolbox: false });
  return {
    setXRange(min, max) {
      ec.inst.setOption({ xAxis: { min, max } });
    },
    update(Q, Qr, tr, n, { rangePts = [], calcFn = null } = {}) {
      const qFrom = Qr * 0.02, qTo = Qr;
      const qSet = new Set();
      const N = 120;
      for (let i = 0; i <= N; i++) qSet.add(+(qFrom + (qTo - qFrom) * i / N).toFixed(2));
      qSet.add(+Q.toFixed(2));
      const qs = [...qSet].sort((a, b) => a - b);
      const fn = calcFn || (q => calc(q, Qr, tr, n));
      const ws = qs.map(q => smartRound(fn(q).W));
      ec.update({
        title: { left: "center" },
        xAxis: { type: "value", name: "Qнс, л/с", nameLocation: "middle", nameGap: 24, min: "dataMin", axisLabel: { formatter: v => +v.toFixed(2) } },
        yAxis: { type: "value", name: "Wнс, м³", min: 0, nameLocation: "middle", nameGap: 40 },
        tooltip: {
          formatter: params => {
            const p = params.find(p => p.seriesName === "Wнс, м³");
            if (!p) return "";
            const x = p.value[0];
            const v = fn(x);
            const lines = [`Qнс = <b>${fmt(x, 0)} л/с</b>`, `Wнс = <b>${fmt(p.value[1], 1)} м³</b>, наполнение ${fmt(v.tk - v.tn, 1)} мин`];
            const vp = params.find(p => p.seriesName === "Варианты из таблицы");
            if (vp) lines.push(`вариант: Wнс = ${fmt(vp.value[1], 1)} м³`);
            return lines.join("<br>");
          },
        },
        series: [
          { name: "Wнс, м³", type: "line", showSymbol: false, data: qs.map((q, i) => [q, ws[i]]),
            lineStyle: { color: "#1f6feb", width: 2 }, itemStyle: { color: "#1f6feb" }, smooth: 0.2 },
          { name: "Qнс, л/с", type: "scatter", data: [[+Q.toFixed(2), fn(+Q.toFixed(2)).W]],
            symbolSize: 10, itemStyle: { color: "#d6336c" }, z: 5 },
          { name: "Варианты из таблицы", type: "scatter", data: rangePts.map(p => [p.x, p.y]),
            symbolSize: 7, itemStyle: { color: "#f08c00" } },
        ],
        legend: { data: ["Wнс, м³", "Qнс, л/с", "Варианты из таблицы"], left: "center", right: "center", padding: -5 },
      });
    },
  };
}

function makeQTChart(el, { onHelp = null } = {}) {
  const ec = makeEChart(el, { slider: true, legend: true, title: "Гидрограф дождевого стока Q(T)", toolbox: false });
  let lastTitle = "";
  return {
    update(Q, Qr, tr, n, r, { extra = [], hydroFn = null, title = "Гидрограф дождевого стока Q(T)" } = {}) {
      lastTitle = title;
      const hf = hydroFn || (t => hydro(t, Qr, tr, n));
      const tMax = Math.max(1.5 * r.tk, 2 * tr);
      const tSet = new Set();
      const N = 120;
      for (let i = 0; i <= N; i++) tSet.add(+(tMax * i / N).toFixed(3));
      const lo = Math.max(0, 0.7 * tr), hi = Math.min(tMax, 1.3 * tr);
      const M = 100;
      for (let i = 0; i <= M; i++) tSet.add(+(lo + (hi - lo) * i / M).toFixed(3));
      tSet.add(tr);
      const ts = [...tSet].sort((a, b) => a - b);
      const qs = ts.map(t => +hf(t).toFixed(2));
      const fill = ts.map((t, i) => (t >= r.tn && t <= r.tk ? [t, qs[i]] : [t, null]));
      const extraSeries = extra.map(ds => ({
        name: ds.label, type: "line", showSymbol: false,
        data: ds.data.map((y, i) => [ts[i], y]),
        lineStyle: { color: ds.borderColor, width: ds.borderWidth || 1, type: ds.borderDash ? "dashed" : "solid" },
        itemStyle: { color: ds.borderColor },
      }));
      ec.update({
        title: { text: lastTitle, left: "center" },
        xAxis: { type: "value", name: "T, мин", nameLocation: "middle", nameGap: 24, min: 0 },
        yAxis: { type: "value", name: "Q, л/с", min: 0 },
        tooltip: { formatter: ecAxisTip("л/с") },
        legend: { data: ["Q(T), л/с", ...extra.map(d => d.label), "Wнс (площадь)"], left: "center" },
        series: [
          { name: "Q(T), л/с", type: "line", showSymbol: false, data: ts.map((t, i) => [t, qs[i]]),
            lineStyle: { color: "#1f6feb", width: 2 }, itemStyle: { color: "#1f6feb" }, smooth: 0.2,
            markLine: {
              symbol: "none", silent: true, animation: false,
              data: [
                { name: "Tн", xAxis: r.tn, lineStyle: { color: "#8a929c", type: "dashed" }, label: { formatter: "Tн", position: "insideEndTop" } },
                { name: "tr", xAxis: tr, lineStyle: { color: "#8a929c", type: "dashed" }, label: { formatter: "tr", position: "insideEndTop" } },
                { name: "Tк", xAxis: r.tk, lineStyle: { color: "#8a929c", type: "dashed" }, label: { formatter: "Tк", position: "insideEndTop" } },
                { name: "Qнс", yAxis: Q, lineStyle: { color: "#d6336c", type: "dashed", width: 1.5 }, label: { formatter: `Qнс = ${fmt(Q)} л/с`, position: "insideStartTop" } },
              ],
            },
          },
          ...extraSeries,
          { name: "Wнс (площадь)", type: "line", showSymbol: false, data: fill,
            lineStyle: { width: 0 }, areaStyle: { origin: Q, color: "rgba(31, 111, 235, 0.18)" },
            tooltip: { show: false } },
        ],
      });
    },
  };
}

function fillVariants(tbody, Q, from, to, step, calcFn) {
  tbody.innerHTML = "";
  const fn = calcFn || calc;
  for (let q = from, i = 0; q <= to + 1e-9 && i < 51; q += step, i++) {
    const v = fn(q);
    const row = tbody.insertRow();
    if (Math.abs(q - Q) < step / 2) row.className = "active";
    [fmt(q, 0), fmt(q * 3.6, 1), fmt(v.tn), fmt(v.tk), fmt(v.W, 1)]
      .forEach(x => row.insertCell().textContent = x);
  }
}
